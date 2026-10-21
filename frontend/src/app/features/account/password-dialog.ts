import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators, type ValidatorFn } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { apiError } from '../../core/auth';

const sameAsNew: ValidatorFn = (group) => {
  const { newPassword, repeat } = (group as FormGroup).controls;
  const mismatch = !!repeat!.value && repeat!.value !== newPassword!.value;
  repeat!.setErrors(mismatch ? { mismatch: true } : repeat!.hasError('required') ? { required: true } : null);
  return null;
};

@Component({
  selector: 'app-password-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <h2 mat-dialog-title>Change password</h2>

      <!-- Material drops the top padding after a title, which would clip the floating label. -->
      <mat-dialog-content class="grid! gap-1 pt-3!">
        @if (error(); as message) {
          <div role="alert" class="mb-3 rounded-md border border-late-border bg-late-surface px-3 py-2 text-[13px] text-late">{{ message }}</div>
        }

        <mat-form-field appearance="outline">
          <mat-label>Current password</mat-label>
          <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" cdkFocusInitial />
          @if (form.controls.currentPassword.hasError('required')) {
            <mat-error>Enter your current password</mat-error>
          } @else if (form.controls.currentPassword.hasError('server')) {
            <mat-error>Current password is wrong</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>New password</mat-label>
          <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
          @if (form.controls.newPassword.hasError('required')) {
            <mat-error>Enter a new password</mat-error>
          } @else if (form.controls.newPassword.hasError('minlength')) {
            <mat-error>Use at least 8 characters</mat-error>
          } @else {
            <mat-hint>At least 8 characters. Your other devices will be signed out.</mat-hint>
          }
        </mat-form-field>

        <mat-form-field appearance="outline" class="mt-2">
          <mat-label>Repeat new password</mat-label>
          <input matInput type="password" formControlName="repeat" autocomplete="new-password" />
          @if (form.controls.repeat.hasError('mismatch')) {
            <mat-error>The passwords do not match</mat-error>
          } @else if (form.controls.repeat.hasError('required')) {
            <mat-error>Repeat the new password</mat-error>
          }
        </mat-form-field>
      </mat-dialog-content>

      <mat-dialog-actions>
        <button matButton="outlined" type="button" mat-dialog-close [disabled]="busy()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Change password' }}</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class PasswordDialog {
  private readonly http = inject(HttpClient);
  private readonly ref = inject<MatDialogRef<PasswordDialog>>(MatDialogRef);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup(
    {
      currentPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      newPassword: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
      repeat: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: sameAsNew },
  );

  protected async save(): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.http.post('/api/auth/password', { currentPassword, newPassword }));
      this.ref.close(true);
    } catch (err) {
      const { error, field } = apiError(err);
      if (field === 'currentPassword') this.form.controls.currentPassword.setErrors({ server: true });
      else this.error.set(error);
    } finally {
      this.busy.set(false);
    }
  }
}
