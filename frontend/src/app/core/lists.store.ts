import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { firstValueFrom } from 'rxjs';
import { apiError } from './auth';
import type { TodoList } from './models';

const LAST_LIST_KEY = 'todo-list';

@Injectable({ providedIn: 'root' })
export class ListsStore {
  private readonly http = inject(HttpClient);
  private loading: Promise<void> | null = null;

  readonly lists = signal<TodoList[]>([]);

  /** Loads the lists once per sign-in; later calls wait for the same request. A failure is shown and retried next time. */
  ready(): Promise<void> {
    return (this.loading ??= this.load().catch((err) => {
      this.loading = null;
      toast.error(apiError(err).error);
    }));
  }

  async load(): Promise<void> {
    const { lists } = await firstValueFrom(this.http.get<{ lists: TodoList[] }>('/api/lists'));
    this.lists.set(lists);
  }

  find(id: number): TodoList | undefined {
    return this.lists().find((l) => l.id === id);
  }

  reset(): void {
    this.loading = null;
    this.lists.set([]);
  }

  async create(name: string): Promise<TodoList> {
    const { list } = await firstValueFrom(this.http.post<{ list: TodoList }>('/api/lists', { name }));
    this.lists.update((all) => [...all, list]);
    return list;
  }

  async rename(id: number, name: string): Promise<TodoList> {
    const { list } = await firstValueFrom(this.http.patch<{ list: TodoList }>(`/api/lists/${id}`, { name }));
    this.lists.update((all) => all.map((l) => (l.id === id ? list : l)));
    return list;
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/lists/${id}`));
    this.lists.update((all) => all.filter((l) => l.id !== id));
  }

  /** The sidebar count of the open list follows the board as cards change. */
  setOpenTasks(id: number, openTasks: number): void {
    this.lists.update((all) => all.map((l) => (l.id === id && l.openTasks !== openTasks ? { ...l, openTasks } : l)));
  }

  /** The list opened last on this device, so /board returns to it. */
  remember(id: number): void {
    try {
      localStorage.setItem(LAST_LIST_KEY, String(id));
    } catch {
      // Private mode or blocked storage: /board opens the first list instead.
    }
  }

  lastOpened(): TodoList | undefined {
    try {
      return this.find(Number(localStorage.getItem(LAST_LIST_KEY)));
    } catch {
      return undefined;
    }
  }
}

/** /board opens the list used last, or the first one. */
export const lastListGuard: CanActivateFn = async () => {
  const lists = inject(ListsStore);
  const router = inject(Router);
  await lists.ready();
  const list = lists.lastOpened() ?? lists.lists()[0];
  return list ? router.parseUrl(`/lists/${list.id}`) : true;
};

/** A list that no longer exists (deleted, or a stale link) falls back to /board. */
export const listGuard: CanActivateFn = async (route) => {
  const lists = inject(ListsStore);
  const router = inject(Router);
  const id = Number(route.paramMap.get('listId'));
  await lists.ready();
  // Someone else may have made it since the sidebar loaded.
  if (!lists.find(id)) await lists.load().catch(() => undefined);
  return lists.find(id) ? true : router.parseUrl('/board');
};
