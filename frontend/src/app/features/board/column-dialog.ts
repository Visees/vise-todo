import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { toast } from '@spartan-ng/brain/sonner';
import { apiError } from '../../core/auth';
import type { BoardColumn } from '../../core/models';
import { TodosStore } from '../../core/todos.store';

/** Open with a `column` to edit it, or with nothing to add one to the open list. */
export interface ColumnDialogData {
  column?: BoardColumn;
}

@Component({
  selector: 'app-column-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <h2 mat-dialog-title>{{ column ? 'Edit column' : 'New column' }}</h2>

      <!-- Material drops the top padding after a title, which would clip the floating label. -->
      <mat-dialog-content class="grid! gap-1 pt-3!">
        @if (error(); as message) {
          <div role="alert" class="mb-3 rounded-md border border-late-border bg-late-surface px-3 py-2 text-[13px] text-late">{{ message }}</div>
        }

        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" maxlength="50" autocomplete="off" cdkFocusInitial />
          @if (form.controls.name.hasError('required')) {
            <mat-error>Give the column a name</mat-error>
          }
        </mat-form-field>

        @if (positions.length > 1) {
          <mat-form-field appearance="outline">
            <mat-label>Position</mat-label>
            <mat-select formControlName="index">
              @for (label of positions; track $index) {
                <mat-option [value]="$index">{{ label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        <div class="-mt-1 -ml-2">
          <mat-checkbox formControlName="done">Cards here are done</mat-checkbox>
          <p class="-mt-1.5 ml-2 text-xs text-muted-foreground">They are struck through, never overdue, and removed by Clear done.</p>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions>
        @if (column) {
          <button matButton type="button" class="mr-auto! text-late!" [disabled]="busy()" (click)="remove()">Delete</button>
        }
        <button matButton="outlined" type="button" mat-dialog-close [disabled]="busy()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="busy()">
          {{ busy() ? 'Saving…' : column ? 'Save' : 'Add column' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class ColumnDialog {
  private readonly ref = inject<MatDialogRef<ColumnDialog>>(MatDialogRef);
  private readonly store = inject(TodosStore);

  protected readonly column = inject<ColumnDialogData | null>(MAT_DIALOG_DATA)?.column;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The other columns, left to right; the new or edited one goes before one of them or last. */
  private readonly others = this.store.columns().filter((c) => c.id !== this.column?.id);
  protected readonly positions = ['First', ...this.others.map((c) => `After “${c.name}”`)];
  /** A new column goes just before the first done column, else last. */
  private readonly firstDone = this.others.findIndex((c) => c.done);
  private readonly startIndex = this.column
    ? this.store.columns().findIndex((c) => c.id === this.column!.id)
    : this.firstDone === -1 ? this.others.length : this.firstDone;

  protected readonly form = new FormGroup({
    name: new FormControl(this.column?.name ?? '', { nonNullable: true, validators: [Validators.required] }),
    index: new FormControl(this.startIndex, { nonNullable: true }),
    done: new FormControl(this.column?.done ?? false, { nonNullable: true }),
  });

  protected async save(): Promise<void> {
    const name = this.form.controls.name.value.trim();
    this.form.controls.name.setValue(name);
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const { index, done } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.column) await this.store.updateColumn(this.column.id, { name, done, index });
      else await this.store.addColumn({ name, done, index });
      this.ref.close();
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const column = this.column!;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.removeColumn(column.id);
      toast(`Deleted the column “${column.name}”`);
      this.ref.close();
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }
}
