import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { toast } from '@spartan-ng/brain/sonner';
import { apiError } from '../../core/auth';
import { isoDay } from '../../core/dates';
import { COLUMNS, type Status, type Todo } from '../../core/models';
import { TodosStore } from '../../core/todos.store';

/** Open with a `todo` to edit it, or with a `status` to add a card to that column. */
export interface TaskDialogData {
  todo?: Todo;
  status?: Status;
}

function fromIso(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d);
}

@Component({
  selector: 'app-task-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatSelectModule,
    MatButtonModule,
  ],
  providers: [provideNativeDateAdapter()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <h2 mat-dialog-title>{{ editing ? 'Edit task' : 'New task' }}</h2>

      <!-- Material drops the top padding after a title, which would clip the floating label. -->
      <mat-dialog-content class="grid! gap-1 pt-3!">
        @if (error(); as message) {
          <div role="alert" class="mb-3 rounded-md border border-late-border bg-late-surface px-3 py-2 text-[13px] text-late">{{ message }}</div>
        }

        <mat-form-field appearance="outline">
          <mat-label>Title</mat-label>
          <textarea matInput formControlName="title" cdkFocusInitial cdkTextareaAutosize cdkAutosizeMinRows="2" cdkAutosizeMaxRows="6"
            maxlength="500" (keydown.enter)="submitOnEnter($event)"></textarea>
          @if (form.controls.title.hasError('required')) {
            <mat-error>Write something to do</mat-error>
          }
          <mat-hint align="end">{{ form.controls.title.value.length }}/500</mat-hint>
        </mat-form-field>

        <div class="grid gap-x-3 sm:grid-cols-2">
          <mat-form-field appearance="outline">
            <mat-label>Due date</mat-label>
            <input matInput [matDatepicker]="picker" formControlName="dueDate" placeholder="None" />
            <mat-datepicker-toggle matIconSuffix [for]="picker" />
            <mat-datepicker #picker />
            @if (form.controls.dueDate.hasError('matDatepickerParse')) {
              <mat-error>Use a valid date</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Column</mat-label>
            <mat-select formControlName="status">
              @for (column of columns; track column.status) {
                <mat-option [value]="column.status">{{ column.title }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions>
        @if (editing) {
          <button matButton type="button" class="mr-auto! text-late!" [disabled]="busy()" (click)="remove()">Delete</button>
        }
        <button matButton="outlined" type="button" mat-dialog-close [disabled]="busy()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="busy()">
          {{ busy() ? 'Saving…' : editing ? 'Save' : 'Add task' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class TaskDialog {
  private readonly data = inject<TaskDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<TaskDialog>>(MatDialogRef);
  private readonly store = inject(TodosStore);

  protected readonly columns = COLUMNS;
  protected readonly editing = !!this.data.todo;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    title: new FormControl(this.data.todo?.title ?? '', { nonNullable: true, validators: [Validators.required] }),
    dueDate: new FormControl<Date | null>(fromIso(this.data.todo?.dueDate ?? null)),
    status: new FormControl<Status>(this.data.todo?.status ?? this.data.status ?? 'todo', { nonNullable: true }),
  });

  /** Enter saves, Shift+Enter adds a line break. */
  protected submitOnEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.save();
  }

  protected async save(): Promise<void> {
    const title = this.form.controls.title.value.trim();
    this.form.controls.title.setValue(title);
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const due = this.form.controls.dueDate.value;
    const dueDate = due ? isoDay(due) : null;
    const status = this.form.controls.status.value;
    this.busy.set(true);
    this.error.set(null);
    try {
      const todo = this.data.todo;
      if (!todo) {
        await this.store.add(title, dueDate, status);
      } else {
        if (title !== todo.title || dueDate !== todo.dueDate) await this.store.update(todo.id, { title, dueDate });
        // A new column puts the card on top of it, like a drop.
        if (status !== todo.status) await this.store.move(todo.id, status, 0);
      }
      this.ref.close(true);
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const todo = this.data.todo!;
    this.busy.set(true);
    try {
      await this.store.remove(todo.id);
      toast(`Deleted “${todo.title.length > 40 ? todo.title.slice(0, 40) + '…' : todo.title}”`);
      this.ref.close(true);
    } catch (err) {
      this.error.set(apiError(err).error);
    } finally {
      this.busy.set(false);
    }
  }
}
