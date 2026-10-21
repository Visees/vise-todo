import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { inView } from './dates';
import { TASK_VIEWS, type Todo, type TaskView } from './models';

type TodoPatch = Partial<Pick<Todo, 'title' | 'done' | 'dueDate'>>;

@Injectable({ providedIn: 'root' })
export class TodosStore {
  private readonly http = inject(HttpClient);

  readonly todos = signal<Todo[]>([]);
  readonly loaded = signal(false);

  readonly openCount = computed(() => this.todos().filter((t) => !t.done).length);
  readonly doneCount = computed(() => this.todos().length - this.openCount());

  /** Sidebar counts: open tasks per view, completed tasks for "Completed". */
  readonly counts = computed(() => {
    const todos = this.todos();
    const out = {} as Record<TaskView, number>;
    for (const view of Object.keys(TASK_VIEWS) as TaskView[]) {
      out[view] = todos.filter((t) => inView(t, view) && (view === 'done' || !t.done)).length;
    }
    return out;
  });

  async load(): Promise<void> {
    const { todos } = await firstValueFrom(this.http.get<{ todos: Todo[] }>('/api/todos'));
    this.todos.set(todos);
    this.loaded.set(true);
  }

  reset(): void {
    this.todos.set([]);
    this.loaded.set(false);
  }

  async add(title: string, dueDate: string | null): Promise<void> {
    const { todo } = await firstValueFrom(this.http.post<{ todo: Todo }>('/api/todos', { title, dueDate }));
    this.todos.update((list) => [todo, ...list]);
  }

  async update(id: number, patch: TodoPatch): Promise<void> {
    const { todo } = await firstValueFrom(this.http.patch<{ todo: Todo }>(`/api/todos/${id}`, patch));
    this.todos.update((list) => list.map((t) => (t.id === id ? todo : t)));
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/todos/${id}`));
    this.todos.update((list) => list.filter((t) => t.id !== id));
  }

  async clearCompleted(): Promise<number> {
    const { removed } = await firstValueFrom(this.http.delete<{ removed: number }>('/api/todos/completed'));
    this.todos.update((list) => list.filter((t) => !t.done));
    return removed;
  }
}
