import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import type { Member, Status, Todo } from './models';

export interface TodoInput {
  listId: number;
  title: string;
  dueDate: string | null;
  status: Status;
  assigneeId: number | null;
}

type TodoPatch = Partial<Pick<TodoInput, 'title' | 'dueDate' | 'assigneeId' | 'listId'>>;

const byPosition = (a: Todo, b: Todo) => a.position - b.position || b.createdAt.localeCompare(a.createdAt);

@Injectable({ providedIn: 'root' })
export class TodosStore {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** The list on screen; `todos` holds its cards. */
  readonly listId = signal<number | null>(null);
  readonly todos = signal<Todo[]>([]);
  readonly loaded = signal(false);
  /** Everyone a card can be assigned to. */
  readonly members = signal<Member[]>([]);

  /** Cards per column, in board order. */
  readonly board = computed(() => {
    const out: Record<Status, Todo[]> = { todo: [], doing: [], done: [] };
    for (const t of this.todos()) out[t.status].push(t);
    for (const list of Object.values(out)) list.sort(byPosition);
    return out;
  });

  readonly openCount = computed(() => this.todos().filter((t) => t.status !== 'done').length);

  /** Shows the cards of `listId`; with no argument, reloads the current list. */
  async load(listId = this.listId()): Promise<void> {
    if (listId === null) return;
    if (listId !== this.listId()) {
      this.listId.set(listId);
      this.todos.set([]);
      this.loaded.set(false);
    }
    const { todos } = await firstValueFrom(this.http.get<{ todos: Todo[] }>('/api/todos', { params: { listId } }));
    // Switching lists quickly: only the answer for the list still on screen counts.
    if (listId !== this.listId()) return;
    this.todos.set(todos);
    this.loaded.set(true);
  }

  async loadMembers(): Promise<void> {
    const { users } = await firstValueFrom(this.http.get<{ users: Member[] }>('/api/users'));
    this.members.set(users);
  }

  reset(): void {
    this.listId.set(null);
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
   * Moves a card to `index` in column `status`. The board updates at once
   * (so the drop does not jump back), then takes the server's order.
   */
  async move(id: number, status: Status, index: number): Promise<void> {
    const board = this.board();
    const card = this.todos().find((t) => t.id === id);
    if (!card) return;
    const target = board[status].filter((t) => t.id !== id);
    target.splice(index, 0, { ...card, status });
    const placed = new Map(target.map((t, i) => [t.id, { ...t, position: i }]));
    this.todos.update((list) => list.map((t) => placed.get(t.id) ?? t));
    try {
      const { todos } = await firstValueFrom(
        this.http.post<{ todos: Todo[] }>(`/api/todos/${id}/move`, { status, index }),
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
    this.todos.update((list) => list.filter((t) => t.status !== 'done'));
    return removed;
  }
}
