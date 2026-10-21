import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { apiError } from '../../core/auth';
import { AuthService } from '../../core/auth.service';
import { BrandMark } from '../../layout/brand-mark';

type Mode = 'login' | 'register';
type Field = 'name' | 'email' | 'password';

@Component({
  selector: 'app-login',
  imports: [HlmButtonImports, HlmInputImports, HlmLabelImports, BrandMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'grid min-h-full place-items-center bg-subtle px-4 py-8' },
  template: `
    <div class="w-full max-w-[380px]">
      <app-brand-mark class="mb-6 justify-center" />

      <form
        class="rounded-lg border border-border bg-card p-6 shadow-xs"
        novalidate
        (submit)="$event.preventDefault(); submit()"
      >
        <h1 class="text-xl font-semibold text-foreground">{{ register() ? 'Create your account' : 'Sign in' }}</h1>
        <p class="mt-1 mb-5 text-[13px] text-muted-foreground">
          {{ register() ? 'You only need a name, an email and a password.' : 'Enter your email and password to see your tasks.' }}
        </p>

        @if (error(); as message) {
          <div role="alert" class="mb-4 rounded-md border border-late-border bg-late-surface px-3 py-2 text-[13px] text-late">
            {{ message }}
          </div>
        }

        @if (register()) {
          <div class="mb-3.5">
            <label hlmLabel for="f-name" class="mb-1.5 text-xs text-body">Name</label>
            <input hlmInput id="f-name" autocomplete="name" [value]="name()" (input)="name.set(value($event))"
              [attr.aria-invalid]="errorField() === 'name' || null" />
          </div>
        }
        <div class="mb-3.5">
          <label hlmLabel for="f-email" class="mb-1.5 text-xs text-body">Email</label>
          <input hlmInput id="f-email" type="email" autocomplete="email" [value]="email()" (input)="email.set(value($event))"
            [attr.aria-invalid]="errorField() === 'email' || null" />
        </div>
        <div class="mb-3.5">
          <label hlmLabel for="f-password" class="mb-1.5 text-xs text-body">Password</label>
          <input hlmInput id="f-password" type="password" [value]="password()" (input)="password.set(value($event))"
            [attr.autocomplete]="register() ? 'new-password' : 'current-password'"
            [attr.placeholder]="register() ? 'At least 8 characters' : null"
            [attr.aria-invalid]="errorField() === 'password' || null" />
        </div>

        <button hlmBtn type="submit" class="mt-1.5 h-10 w-full shadow-xs" [disabled]="busy()">
          {{ busy() ? (register() ? 'Creating account…' : 'Signing in…') : register() ? 'Create account' : 'Sign in' }}
        </button>
      </form>

      @if (signupOpen()) {
        <p class="mt-4 text-center text-[13px] text-muted-foreground">
          {{ register() ? 'Already have an account?' : 'No account yet?' }}
          <button type="button" class="link" (click)="toggle()">{{ register() ? 'Sign in' : 'Create one' }}</button>
        </p>
      } @else {
        <p class="mt-4 text-center text-[13px] text-muted-foreground">No account yet? Ask an admin to create one for you.</p>
      }
    </div>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly mode = signal<Mode>('login');
  protected readonly register = computed(() => this.mode() === 'register');
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly errorField = signal<Field | null>(null);
  /** Closed once an admin exists, unless ALLOW_SIGNUP is on. */
  protected readonly signupOpen = signal(false);

  constructor() {
    inject(HttpClient)
      .get<{ signupOpen: boolean }>('/api/auth/config')
      .subscribe({ next: ({ signupOpen }) => this.signupOpen.set(signupOpen), error: () => undefined });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected toggle(): void {
    this.mode.set(this.register() ? 'login' : 'register');
    this.error.set(null);
    this.errorField.set(null);
  }

  protected async submit(): Promise<void> {
    this.error.set(null);
    this.errorField.set(null);
    this.busy.set(true);
    try {
      if (this.register()) await this.auth.register(this.name(), this.email(), this.password());
      else await this.auth.login(this.email(), this.password());
      this.password.set('');
      await this.router.navigateByUrl('/board');
    } catch (err) {
      const { error, field } = apiError(err);
      this.error.set(error);
      if (field === 'name' || field === 'email' || field === 'password') {
        this.errorField.set(field);
        document.getElementById(`f-${field}`)?.focus();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
