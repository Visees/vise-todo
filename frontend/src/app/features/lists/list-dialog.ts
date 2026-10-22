import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { apiError } from '../../core/auth';
import { ListsStore } from '../../core/lists.store';
import type { TodoList } from '../../core/models';

/** Open with a `list` to rename it, or with nothing to make a new one. Closes with the saved list. */
export interface ListDialogData {
  list?: TodoList;
}

@Component({
  selector: 'app-list-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <h2 mat-dialog-title>{{ list ? 'Rename list' : 'New list' }}</h2>

      <!-- Material drops the top padding after a title, which would clip the floating label. -->
      <mat-dialog-content class="grid! gap-1 pt-3!">
        @if (error(); as message) {
          <div role="alert" class="mb-3 rounded-md border border-late-border bg-late-surface px-3 py-2 text-[13px] text-late">{{ message }}</div>
        }

        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" maxlength="100" autocomplete="off" cdkFocusInitial />
          @if (form.controls.name.hasError('required')) {
            <mat-error>Give the list a name</mat-error>
          } @else if (!list) {
            <mat-hint>Everyone can see the list. Cards in it show to their creator and assignee, as on any board.</mat-hint>
          }
        </mat-form-field>
      </mat-dialog-content>

      <mat-dialog-actions>
        <button matButton="outlined" type="button" mat-dialog-close [disabled]="busy()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="busy()">
          {{ busy() ? 'Saving…' : list ? 'Rename' : 'Create list' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class ListDialog {
  private readonly ref = inject<MatDialogRef<ListDialog, TodoList>>(MatDialogRef);
  private readonly lists = inject(ListsStore);

  protected readonly list = inject<ListDialogData | null>(MAT_DIALOG_DATA)?.list;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = new FormGroup({
    name: new FormControl(this.list?.name ?? '', { nonNullable: true, validators: [Validators.required] }),
  });

  protected async save(): Promise<void> {
    const name = this.form.controls.name.value.trim();
    this.form.controls.name.setValue(name);
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    if (name === this.list?.name) {
      this.ref.close(this.list);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      this.ref.close(this.list ? await this.lists.rename(this.list.id, name) : await this.lists.create(name));
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }
}
