import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Status, Todo } from './models';

type TodoPatch = Partial<Pick<Todo, 'title' | 'dueDate'>>;

const byPosition = (a: Todo, b: Todo) => a.position - b.position || b.createdAt.localeCompare(a.createdAt);

@Injectable({ providedIn: 'root' })
export class TodosStore {
  private readonly http = inject(HttpClient);

  readonly todos = signal<Todo[]>([]);
  readonly loaded = signal(false);

  /** Cards per column, in board order. */
  readonly board = computed(() => {
    const out: Record<Status, Todo[]> = { todo: [], doing: [], done: [] };
    for (const t of this.todos()) out[t.status].push(t);
    for (const list of Object.values(out)) list.sort(byPosition);
    return out;
  });

  readonly openCount = computed(() => this.todos().filter((t) => t.status !== 'done').length);

  async load(): Promise<void> {
    const { todos } = await firstValueFrom(this.http.get<{ todos: Todo[] }>('/api/todos'));
    this.todos.set(todos);
    this.loaded.set(true);
  }

  reset(): void {
    this.todos.set([]);
    this.loaded.set(false);
  }

  async add(title: string, dueDate: string | null, status: Status = 'todo'): Promise<void> {
    const { todo } = await firstValueFrom(this.http.post<{ todo: Todo }>('/api/todos', { title, dueDate, status }));
    this.todos.update((list) => [todo, ...list]);
  }

  async update(id: number, patch: TodoPatch): Promise<void> {
    const { todo } = await firstValueFrom(this.http.patch<{ todo: Todo }>(`/api/todos/${id}`, patch));
    this.todos.update((list) => list.map((t) => (t.id === id ? todo : t)));
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
    const { removed } = await firstValueFrom(this.http.delete<{ removed: number }>('/api/todos/done'));
    this.todos.update((list) => list.filter((t) => t.status !== 'done'));
    return removed;
  }
}
