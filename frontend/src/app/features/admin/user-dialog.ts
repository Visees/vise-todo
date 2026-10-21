import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { apiError } from '../../core/auth';
import type { ManagedUser, Role } from '../../core/models';
import { UsersStore } from './users.store';

/** Open with a `user` to edit it, or without to create one. `self` marks the admin's own row. */
export interface UserDialogData {
  user?: ManagedUser;
  self?: boolean;
}

type Field = 'name' | 'email' | 'password' | 'role';

/** 14 characters from an alphabet without look-alikes (0/O, 1/l/I), easy to read out or type. */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
}

@Component({
  selector: 'app-user-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <h2 mat-dialog-title>{{ editing ? 'Edit user' : 'New user' }}</h2>

      <!-- Material drops the top padding after a title, which would clip the floating label. -->
      <mat-dialog-content class="grid! gap-1 pt-3!">
        @if (error(); as message) {
          <div role="alert" class="mb-3 rounded-md border border-late-border bg-late-surface px-3 py-2 text-[13px] text-late">{{ message }}</div>
        }

        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" autocomplete="off" cdkFocusInitial />
          @if (form.controls.name.hasError('required')) {
            <mat-error>Enter a name</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Email</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="off" />
          @if (form.controls.email.hasError('required')) {
            <mat-error>Enter an email</mat-error>
          } @else if (form.controls.email.hasError('email')) {
            <mat-error>Enter a valid email</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Role</mat-label>
          <mat-select formControlName="role">
            <mat-option value="member">Member</mat-option>
            <mat-option value="admin">Admin</mat-option>
          </mat-select>
          <mat-hint>{{ data.self ? 'You cannot remove your own admin role.' : 'Admins can create, edit and delete users.' }}</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="mt-2">
          <mat-label>{{ editing ? 'New password' : 'Password' }}</mat-label>
          <input matInput type="text" formControlName="password" autocomplete="new-password" spellcheck="false" class="font-mono" />
          <button matButton matSuffix type="button" class="mr-1!" (click)="generate()">Generate</button>
          @if (form.controls.password.hasError('required')) {
            <mat-error>Set a password</mat-error>
          } @else if (form.controls.password.hasError('minlength')) {
            <mat-error>Use at least 8 characters</mat-error>
          } @else {
            <mat-hint>
              {{ editing ? 'Leave empty to keep the current one. A new password signs the user out.' : 'Share it with the user; they sign in with it.' }}
            </mat-hint>
          }
        </mat-form-field>
      </mat-dialog-content>

      <mat-dialog-actions>
        <button matButton="outlined" type="button" mat-dialog-close [disabled]="busy()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="busy()">
          {{ busy() ? 'Saving…' : editing ? 'Save' : 'Create user' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class UserDialog {
  protected readonly data = inject<UserDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<UserDialog>>(MatDialogRef);
  private readonly store = inject(UsersStore);

  protected readonly editing = !!this.data.user;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    name: new FormControl(this.data.user?.name ?? '', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl(this.data.user?.email ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    role: new FormControl<Role>({ value: this.data.user?.role ?? 'member', disabled: !!this.data.self }, { nonNullable: true }),
    password: new FormControl('', {
      nonNullable: true,
      validators: this.editing ? [Validators.minLength(8)] : [Validators.required, Validators.minLength(8)],
    }),
  });

  protected generate(): void {
    this.form.controls.password.setValue(generatePassword());
    this.form.controls.password.markAsTouched();
  }

  protected async save(): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, email, role, password } = this.form.getRawValue();
    const input = { name: name.trim(), email: email.trim(), role, ...(password ? { password } : {}) };
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.data.user) await this.store.update(this.data.user.id, input);
      else await this.store.create(input);
      this.ref.close(true);
    } catch (err) {
      const { error, field } = apiError(err);
      this.error.set(error);
      const control = field ? this.form.get(field as Field) : null;
      control?.setErrors({ server: true });
    } finally {
      this.busy.set(false);
    }
  }
}
