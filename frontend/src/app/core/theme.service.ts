import { DOCUMENT, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ThemeChoice = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'todo-theme';

/**
 * System (default, follows prefers-color-scheme), Light or Dark. The choice lives
 * in localStorage and becomes the `dark` class on <html>; index.html applies it
 * before the first paint.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly media = this.browser ? matchMedia('(prefers-color-scheme: dark)') : null;

  readonly choice = signal<ThemeChoice>(this.read());

  constructor() {
    this.media?.addEventListener('change', () => this.apply());
  }

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Private mode or blocked storage: the choice lasts until reload.
    }
    this.apply();
  }

  private apply(): void {
    const choice = this.choice();
    const dark = choice === 'dark' || (choice === 'system' && !!this.media?.matches);
    this.document.documentElement.classList.toggle('dark', dark);
  }

  private read(): ThemeChoice {
    if (!this.browser) return 'system';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  }
}
