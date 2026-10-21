import { HttpClient } from '@angular/common/http';
import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { User } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  readonly user = signal<User | null>(null);
  private loaded: Promise<void> | null = null;

  /** Resolves once we know whether someone is signed in. Only asks the API when the hint cookie says a session may exist. */
  ready(): Promise<void> {
    this.loaded ??= this.hasSessionHint()
      ? firstValueFrom(this.http.get<{ user: User | null }>('/api/auth/me'))
          .then(({ user }) => this.user.set(user))
          .catch(() => this.user.set(null))
      : Promise.resolve();
    return this.loaded;
  }

  async login(email: string, password: string): Promise<void> {
    const { user } = await firstValueFrom(this.http.post<{ user: User }>('/api/auth/login', { email, password }));
    this.user.set(user);
  }

  async register(name: string, email: string, password: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.post<{ user: User }>('/api/auth/register', { name, email, password }),
    );
    this.user.set(user);
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {})).catch(() => undefined);
    this.user.set(null);
  }

  /** Called when the API answers 401: the session expired or was revoked. */
  forget(): void {
    this.user.set(null);
  }

  private hasSessionHint(): boolean {
    return this.document.cookie.split(';').some((c) => c.trim() === 'session=1');
  }
}
