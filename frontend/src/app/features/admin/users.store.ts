import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ManagedUser, Role } from '../../core/models';

export interface UserInput {
  name: string;
  email: string;
  role: Role;
  /** Required when creating; when editing, empty keeps the current password. */
  password?: string;
}

@Injectable({ providedIn: 'root' })
export class UsersStore {
  private readonly http = inject(HttpClient);

  readonly users = signal<ManagedUser[]>([]);
  readonly loaded = signal(false);

  async load(): Promise<void> {
    const { users } = await firstValueFrom(this.http.get<{ users: ManagedUser[] }>('/api/admin/users'));
    this.users.set(users);
    this.loaded.set(true);
  }

  async create(input: UserInput): Promise<void> {
    const { user } = await firstValueFrom(this.http.post<{ user: ManagedUser }>('/api/admin/users', input));
    this.users.update((list) => [...list, user].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async update(id: number, input: Partial<UserInput>): Promise<void> {
    const { user } = await firstValueFrom(this.http.patch<{ user: ManagedUser }>(`/api/admin/users/${id}`, input));
    this.users.update((list) => list.map((u) => (u.id === id ? user : u)));
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/admin/users/${id}`));
    this.users.update((list) => list.filter((u) => u.id !== id));
  }
}
