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
import { AuthService } from '../../core/auth.service';
import { isoDay } from '../../core/dates';
import { ListsStore } from '../../core/lists.store';
import type { Todo } from '../../core/models';
import { TodosStore } from '../../core/todos.store';

/** Open with a `todo` to edit it, or with a `columnId` to add a card to that column of the open list. */
export interface TaskDialogData {
  todo?: Todo;
  columnId?: number;
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
            <mat-select formControlName="columnId">
              @for (column of columns(); track column.id) {
                <mat-option [value]="column.id">{{ column.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline">
          <mat-label>Assignee</mat-label>
          <mat-select formControlName="assigneeId">
            <mat-option [value]="null">Unassigned</mat-option>
            @for (member of members(); track member.id) {
              <mat-option [value]="member.id">{{ member.name }}{{ member.id === me ? ' (you)' : '' }}</mat-option>
            }
          </mat-select>
          <mat-hint>The task also shows on their board.</mat-hint>
        </mat-form-field>

        @if (lists().length > 1) {
          <mat-form-field appearance="outline" class="mt-2">
            <mat-label>List</mat-label>
            <mat-select formControlName="listId">
              @for (list of lists(); track list.id) {
                <mat-option [value]="list.id">{{ list.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
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
  private readonly listsStore = inject(ListsStore);

  protected readonly columns = this.store.columns;
  protected readonly members = this.store.members;
  protected readonly lists = this.listsStore.lists;
  protected readonly me = inject(AuthService).user()?.id;
  protected readonly editing = !!this.data.todo;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    title: new FormControl(this.data.todo?.title ?? '', { nonNullable: true, validators: [Validators.required] }),
    dueDate: new FormControl<Date | null>(fromIso(this.data.todo?.dueDate ?? null)),
    columnId: new FormControl<number>(this.data.todo?.columnId ?? this.data.columnId ?? this.store.columns()[0]!.id, { nonNullable: true }),
    assigneeId: new FormControl<number | null>(this.data.todo?.assignee?.id ?? null),
    listId: new FormControl<number>(this.data.todo?.listId ?? this.store.listId()!, { nonNullable: true }),
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
    const columnId = this.form.controls.columnId.value;
    const assigneeId = this.form.controls.assigneeId.value;
    const listId = this.form.controls.listId.value;
    this.busy.set(true);
    this.error.set(null);
    try {
      const todo = this.data.todo;
      if (!todo) {
        await this.store.add({ listId, title, dueDate, columnId, assigneeId });
        if (listId !== this.store.listId()) toast(`Added to “${this.listsStore.find(listId)?.name}”`);
      } else {
        // A new column puts the card on top of it, like a drop. Moved first: a new assignee or list may take it off this board,
        // and a new list then puts it in the column there that matches this one best.
        if (columnId !== todo.columnId) await this.store.move(todo.id, columnId, 0);
        if (title !== todo.title || dueDate !== todo.dueDate || assigneeId !== (todo.assignee?.id ?? null) || listId !== todo.listId) {
          await this.store.update(todo.id, { title, dueDate, assigneeId, ...(listId !== todo.listId && { listId }) });
        }
        if (listId !== todo.listId) toast(`Moved to “${this.listsStore.find(listId)?.name}”`);
      }
      // The other list's count in the sidebar changed too.
      if (listId !== this.store.listId()) void this.listsStore.load().catch(() => undefined);
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
