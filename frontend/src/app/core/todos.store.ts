import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import type { BoardColumn, Member, Todo } from './models';

export interface TodoInput {
  listId: number;
  title: string;
  dueDate: string | null;
  /** A column of the open list; for another list, the server picks the closest match there. */
  columnId: number;
  assigneeId: number | null;
}

type TodoPatch = Partial<Pick<TodoInput, 'title' | 'dueDate' | 'assigneeId' | 'listId'>>;

export interface ColumnInput {
  name: string;
  done: boolean;
  /** Where it goes, 0 = first. */
  index: number;
}

const byPosition = (a: Todo, b: Todo) => a.position - b.position || b.createdAt.localeCompare(a.createdAt);

@Injectable({ providedIn: 'root' })
export class TodosStore {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** The list on screen; `columns` and `todos` belong to it. */
  readonly listId = signal<number | null>(null);
  readonly columns = signal<BoardColumn[]>([]);
  readonly todos = signal<Todo[]>([]);
  readonly loaded = signal(false);
  /** Everyone a card can be assigned to. */
  readonly members = signal<Member[]>([]);

  /** Cards per column id, in board order. Every column has an entry. */
  readonly board = computed(() => {
    const out: Record<number, Todo[]> = {};
    for (const c of this.columns()) out[c.id] = [];
    for (const t of this.todos()) out[t.columnId]?.push(t);
    for (const list of Object.values(out)) list.sort(byPosition);
    return out;
  });

  readonly openCount = computed(() => this.todos().filter((t) => !t.done).length);
  readonly doneCount = computed(() => this.todos().filter((t) => t.done).length);

  /** Shows the columns and cards of `listId`; with no argument, reloads the current list. */
  async load(listId = this.listId()): Promise<void> {
    if (listId === null) return;
    if (listId !== this.listId()) {
      this.listId.set(listId);
      this.columns.set([]);
      this.todos.set([]);
      this.loaded.set(false);
    }
    const [{ columns }, { todos }] = await Promise.all([
      firstValueFrom(this.http.get<{ columns: BoardColumn[] }>('/api/columns', { params: { listId } })),
      firstValueFrom(this.http.get<{ todos: Todo[] }>('/api/todos', { params: { listId } })),
    ]);
    // Switching lists quickly: only the answer for the list still on screen counts.
    if (listId !== this.listId()) return;
    this.columns.set(columns);
    this.todos.set(todos);
    this.loaded.set(true);
  }

  async loadMembers(): Promise<void> {
    const { users } = await firstValueFrom(this.http.get<{ users: Member[] }>('/api/users'));
    this.members.set(users);
  }

  reset(): void {
    this.listId.set(null);
    this.columns.set([]);
    this.todos.set([]);
    this.members.set([]);
    this.loaded.set(false);
  }

  async add(input: TodoInput): Promise<void> {
    const { todo } = await firstValueFrom(this.http.post<{ todo: Todo }>('/api/todos', input));
    if (todo.listId === this.listId()) this.todos.update((list) => [todo, ...list]);
  }

  async update(id: number, patch: TodoPatch): Promise<void> {
    const { todo } = await firstValueFrom(this.http.patch<{ todo: Todo }>(`/api/todos/${id}`, patch));
    // Handing someone else's card to another person takes it off this board, unless it shows every card.
    // So does sending it to another list.
    const me = this.auth.user();
    const mine = !!me?.seeAllTasks || todo.ownerId === me?.id || todo.assignee?.id === me?.id;
    const here = mine && todo.listId === this.listId();
    this.todos.update((list) => (here ? list.map((t) => (t.id === id ? todo : t)) : list.filter((t) => t.id !== id)));
  }

  /**
   * Moves a card to `index` in column `columnId`. The board updates at once
   * (so the drop does not jump back), then takes the server's order.
   */
  async move(id: number, columnId: number, index: number): Promise<void> {
    const card = this.todos().find((t) => t.id === id);
    const column = this.columns().find((c) => c.id === columnId);
    if (!card || !column) return;
    const target = (this.board()[columnId] ?? []).filter((t) => t.id !== id);
    target.splice(index, 0, { ...card, columnId, done: column.done });
    const placed = new Map(target.map((t, i) => [t.id, { ...t, position: i }]));
    this.todos.update((list) => list.map((t) => placed.get(t.id) ?? t));
    try {
      const { todos } = await firstValueFrom(
        this.http.post<{ todos: Todo[] }>(`/api/todos/${id}/move`, { columnId, index }),
      );
      this.todos.set(todos);
    } catch (err) {
      await this.load().catch(() => undefined);
      throw err;
    }
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/todos/${id}`));
    this.todos.update((list) => list.filter((t) => t.id !== id));
  }

  async clearDone(): Promise<number> {
    const { removed } = await firstValueFrom(this.http.delete<{ removed: number }>('/api/todos/done', { params: { listId: this.listId()! } }));
    this.todos.update((list) => list.filter((t) => !t.done));
    return removed;
  }

  async addColumn(input: ColumnInput): Promise<void> {
    const listId = this.listId()!;
    const { columns } = await firstValueFrom(this.http.post<{ columns: BoardColumn[] }>('/api/columns', { listId, ...input }));
    if (listId === this.listId()) this.columns.set(columns);
  }

  async updateColumn(id: number, patch: Partial<ColumnInput>): Promise<void> {
    const before = this.columns().find((c) => c.id === id);
    const { columns } = await firstValueFrom(this.http.patch<{ columns: BoardColumn[] }>(`/api/columns/${id}`, patch));
    if (columns[0]?.listId !== this.listId()) return;
    this.columns.set(columns);
    // Its cards are finished, or open again, with it.
    const done = columns.find((c) => c.id === id)?.done;
    if (done !== undefined && done !== before?.done) {
      this.todos.update((list) => list.map((t) => (t.columnId === id ? { ...t, done } : t)));
    }
  }

  async removeColumn(id: number): Promise<void> {
    const { columns } = await firstValueFrom(this.http.delete<{ columns: BoardColumn[] }>(`/api/columns/${id}`));
    if (columns[0]?.listId === this.listId()) this.columns.set(columns);
  }
}
