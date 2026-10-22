import { CdkDrag, CdkDragPlaceholder, CdkDropList, CdkDropListGroup, type CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { apiError } from '../../core/auth';
import { AuthService } from '../../core/auth.service';
import { dueBadge, matchesDue, type DueFilter } from '../../core/dates';
import { initials } from '../../core/initials';
import { ListsStore } from '../../core/lists.store';
import { COLUMNS, type Status, type Todo, type TodoList } from '../../core/models';
import { TodosStore } from '../../core/todos.store';
import { FilterMenu, type FilterOption } from '../../layout/filter-menu';
import { ShellState } from '../../layout/shell';
import { ListDialog, type ListDialogData } from '../lists/list-dialog';
import { TaskDialog, type TaskDialogData } from './task-dialog';

const DUE_OPTIONS: FilterOption[] = [
  { value: 'any', label: 'Any' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'none', label: 'No date' },
];

@Component({
  selector: 'app-board',
  imports: [
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    NgIcon,
    FilterMenu,
    HlmButtonImports,
    HlmInputImports,
    HlmBadgeImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-full flex-col', '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <header class="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 text-[13px] text-muted-foreground md:px-6">
      <button hlmBtn variant="ghost" size="icon-sm" class="-ml-1.5 md:hidden" aria-label="Open menu" (click)="shell.drawerOpen.set(true)">
        <ng-icon name="lucideMenu" size="18" />
      </button>
      <span>Lists</span><span>/</span><span class="truncate font-medium text-foreground">{{ list()?.name }}</span>
    </header>

    <div class="flex w-full flex-1 flex-col p-4 md:p-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-xl font-semibold break-words text-foreground">{{ list()?.name }}</h1>
          <p class="mt-0.5 text-[13px] text-muted-foreground">
            @if (auth.user()?.seeAllTasks) {
              Everyone’s tasks.
            }
            Drag cards between columns, or move a focused card with Alt + arrow keys.
          </p>
        </div>
        <div class="flex items-center gap-1.5">
          <button hlmBtn variant="ghost" size="icon" type="button" title="Rename list" aria-label="Rename list" (click)="renameList()">
            <ng-icon name="lucidePencil" size="16" />
          </button>
          @if (canDeleteList()) {
            <button hlmBtn variant="ghost" size="icon" type="button" title="Delete list" aria-label="Delete list"
              class="hover:bg-late-surface hover:text-late" (click)="deleteList()">
              <ng-icon name="lucideTrash2" size="16" />
            </button>
          }
          <button hlmBtn type="button" class="ml-1 h-10 px-3.5 shadow-xs md:h-9" (click)="openNew('todo')">
            <ng-icon name="lucidePlus" size="16" /> New task
          </button>
        </div>
      </div>

      <div class="mb-3 flex flex-wrap items-center gap-2">
        <div class="relative min-w-[180px] flex-1 basis-full sm:max-w-80 sm:basis-auto">
          <ng-icon name="lucideSearch" size="14" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-placeholder" />
          <label class="sr-only" for="search">Search tasks</label>
          <input #search hlmInput id="search" class="h-8! pr-14 pl-8 text-[13px]" placeholder="Search" autocomplete="off"
            [value]="query()" (input)="query.set(value($event))" />
          <span class="kbd absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline">Ctrl K</span>
        </div>
        <app-filter-menu label="Due" [options]="dueOptions" [(value)]="due" />
        <app-filter-menu label="Assignee" [options]="assigneeOptions()" [(value)]="assignee" />
        @if (filtering()) {
          <button type="button" class="link text-[13px]" (click)="clearFilters()">Clear filters</button>
          <span class="text-xs text-muted-foreground">Dragging is off while filters are on.</span>
        }
        <div class="sm:ml-auto">
          <button hlmBtn variant="outline" size="sm" type="button" [disabled]="!store.board().done.length" (click)="clearDone()">
            Clear done
          </button>
        </div>
      </div>

      <div class="grid flex-1 items-start gap-3 md:grid-cols-3" cdkDropListGroup>
        @for (column of columns; track column.status) {
          @let cards = visible()[column.status];
          <section class="flex min-w-0 flex-col rounded-lg border border-border bg-subtle" [attr.aria-labelledby]="'col-' + column.status">
            <header class="flex items-center gap-2 px-3 pt-2.5 pb-2">
              <h2 [id]="'col-' + column.status" class="text-sm font-semibold text-foreground">{{ column.title }}</h2>
              <span class="rounded-md border border-border bg-background px-1.5 py-px text-[11px] font-medium text-muted-foreground tabular-nums">
                {{ store.board()[column.status].length }}
              </span>
              <button hlmBtn variant="ghost" size="icon-xs" class="ml-auto" type="button" [attr.aria-label]="'Add a task to ' + column.title"
                title="Add task" (click)="openNew(column.status)">
                <ng-icon name="lucidePlus" />
              </button>
            </header>

            <div
              cdkDropList
              [cdkDropListData]="column.status"
              [cdkDropListDisabled]="filtering()"
              (cdkDropListDropped)="drop($event)"
              class="flex min-h-24 flex-col gap-2 px-2 pb-2"
              role="list"
              [attr.aria-label]="column.title"
            >
              @for (todo of cards; track todo.id) {
                <article
                  cdkDrag
                  [cdkDragData]="todo"
                  [cdkDragStartDelay]="{ touch: 180, mouse: 0 }"
                  role="listitem"
                  tabindex="0"
                  [attr.data-card]="todo.id"
                  [attr.aria-label]="todo.title"
                  (keydown)="onCardKey($event, todo)"
                  class="group cursor-grab rounded-md border border-border bg-card p-2.5 shadow-xs transition-colors hover:border-border-strong active:cursor-grabbing"
                >
                  <div class="min-h-12 rounded-md border border-dashed border-border-strong bg-muted" *cdkDragPlaceholder></div>
                  <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <p class="text-[13px] leading-snug break-words" (dblclick)="openEdit(todo)"
                        [class]="todo.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'">{{ todo.title }}</p>
                    </div>
                    <div class="-mt-0.5 -mr-1 flex shrink-0 gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      <button hlmBtn variant="ghost" size="icon-xs" type="button" title="Edit" [attr.aria-label]="'Edit: ' + todo.title"
                        (click)="openEdit(todo)">
                        <ng-icon name="lucidePencil" />
                      </button>
                      <button hlmBtn variant="ghost" size="icon-xs" type="button" title="Delete" class="hover:bg-late-surface hover:text-late"
                        [attr.aria-label]="'Delete: ' + todo.title" (click)="remove(todo)">
                        <ng-icon name="lucideTrash2" />
                      </button>
                    </div>
                  </div>
                  @let b = badge(todo);
                  @if (b || todo.assignee) {
                    <div class="mt-2 flex items-center gap-2">
                      @if (b) {
                        <span hlmBadge class="tabular-nums" [variant]="b.variant">{{ b.text }}</span>
                      }
                      @if (todo.assignee; as a) {
                        <span class="ml-auto grid size-6 shrink-0 place-items-center rounded-full bg-divider text-[10px] font-semibold text-body"
                          role="img" [title]="'Assigned to ' + a.name" [attr.aria-label]="'Assigned to ' + a.name">{{ initials(a.name) }}</span>
                      }
                    </div>
                  }
                </article>
              } @empty {
                <p class="grid min-h-20 place-items-center rounded-md border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
                  {{ !store.loaded() ? 'Loading…' : filtering() ? 'No matching tasks' : 'Drop a card here' }}
                </p>
              }
            </div>
          </section>
        }
      </div>
    </div>

    <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
  `,
})
export class Board {
  /** From the route, /lists/:listId. */
  readonly listId = input.required<string>();

  protected readonly store = inject(TodosStore);
  protected readonly lists = inject(ListsStore);
  private readonly router = inject(Router);
  protected readonly shell = inject(ShellState);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dialog = inject(MatDialog);
  protected readonly auth = inject(AuthService);

  protected readonly columns = COLUMNS;
  protected readonly dueOptions = DUE_OPTIONS;
  protected readonly badge = dueBadge;
  protected readonly initials = initials;

  protected readonly query = signal('');
  protected readonly due = signal<string>('any');
  /** 'any', 'me', 'none', or a member's id. */
  protected readonly assignee = signal<string>('any');
  protected readonly announcement = signal('');

  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  protected readonly list = computed(() => this.lists.find(Number(this.listId())));
  /** Deleting takes every card in the list with it, so only its creator or an admin can. */
  protected readonly canDeleteList = computed(() => {
    const me = this.auth.user();
    return this.lists.lists().length > 1 && (me?.role === 'admin' || this.list()?.createdBy === me?.id);
  });

  constructor() {
    // Switching lists reuses this page: load the new list's cards and start with no filters.
    effect(() => {
      const id = Number(this.listId());
      untracked(() => {
        this.clearFilters();
        this.lists.remember(id);
        this.store.load(id).catch((err) => toast.error(apiError(err).error));
      });
    });
    const title = inject(Title);
    effect(() => {
      const name = this.list()?.name;
      if (name) title.setTitle(`${name} · Todo`);
    });
  }

  protected readonly assigneeOptions = computed<FilterOption[]>(() => {
    const me = this.auth.user()?.id;
    return [
      { value: 'any', label: 'Anyone' },
      { value: 'me', label: 'Me' },
      { value: 'none', label: 'Nobody' },
      ...this.store.members().filter((m) => m.id !== me).map((m) => ({ value: String(m.id), label: m.name })),
    ];
  });

  protected readonly filtering = computed(() => !!this.query().trim() || this.due() !== 'any' || this.assignee() !== 'any');

  protected readonly visible = computed(() => {
    const board = this.store.board();
    if (!this.filtering()) return board;
    const q = this.query().trim().toLowerCase();
    const keep = (t: Todo) =>
      (!q || t.title.toLowerCase().includes(q)) && matchesDue(t, this.due() as DueFilter) && this.matchesAssignee(t);
    return { todo: board.todo.filter(keep), doing: board.doing.filter(keep), done: board.done.filter(keep) };
  });

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private matchesAssignee(todo: Todo): boolean {
    const id = todo.assignee?.id;
    switch (this.assignee()) {
      case 'any':
        return true;
      case 'me':
        return id === this.auth.user()?.id;
      case 'none':
        return id === undefined;
      default:
        return String(id) === this.assignee();
    }
  }

  protected clearFilters(): void {
    this.query.set('');
    this.due.set('any');
    this.assignee.set('any');
  }

  protected onGlobalKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.search().nativeElement.focus();
      this.search().nativeElement.select();
    }
  }

  protected openNew(status: Status): void {
    this.openDialog({ status });
  }

  protected openEdit(todo: Todo): void {
    this.openDialog({ todo });
  }

  /** One Material dialog adds and edits cards; focus returns to where it was opened from. */
  private openDialog(data: TaskDialogData): void {
    this.dialog.open<TaskDialog, TaskDialogData, boolean>(TaskDialog, {
      data,
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }

  protected async drop(event: CdkDragDrop<Status, Status, Todo>): Promise<void> {
    const status = event.container.data;
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex) return;
    await this.moveCard(event.item.data, status, event.currentIndex);
  }

  /** Alt + arrows move the focused card: left/right between columns, up/down inside one. */
  protected async onCardKey(event: KeyboardEvent, todo: Todo): Promise<void> {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      this.openEdit(todo);
      return;
    }
    if (!event.altKey || this.filtering()) return;
    const order = COLUMNS.map((c) => c.status);
    const col = order.indexOf(todo.status);
    const index = this.store.board()[todo.status].findIndex((t) => t.id === todo.id);
    let target: { status: Status; index: number } | null = null;
    if (event.key === 'ArrowLeft' && col > 0) target = { status: order[col - 1]!, index: 0 };
    if (event.key === 'ArrowRight' && col < order.length - 1) target = { status: order[col + 1]!, index: 0 };
    if (event.key === 'ArrowUp' && index > 0) target = { status: todo.status, index: index - 1 };
    if (event.key === 'ArrowDown' && index < this.store.board()[todo.status].length - 1) target = { status: todo.status, index: index + 1 };
    if (!target) return;
    event.preventDefault();
    await this.moveCard(todo, target.status, target.index);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-card="${todo.id}"]`)?.focus(), {
      injector: this.injector,
    });
  }

  private async moveCard(todo: Todo, status: Status, index: number): Promise<void> {
    const column = COLUMNS.find((c) => c.status === status)!;
    try {
      const done = this.store.move(todo.id, status, index);
      const total = this.store.board()[status].length;
      this.announcement.set(`${todo.title}: ${column.title}, position ${index + 1} of ${total}`);
      await done;
    } catch (err) {
      toast.error(apiError(err).error);
    }
  }

  protected renameList(): void {
    this.dialog.open<ListDialog, ListDialogData, TodoList>(ListDialog, {
      data: { list: this.list() },
      width: '420px',
      maxWidth: 'calc(100vw - 32px)',
      restoreFocus: true,
    });
  }

  protected async deleteList(): Promise<void> {
    const list = this.list();
    if (!list || !confirm(`Delete the list “${list.name}” and all its tasks, for everyone?`)) return;
    try {
      await this.lists.remove(list.id);
      toast(`Deleted the list “${list.name}”`);
      await this.router.navigateByUrl('/board');
    } catch (err) {
      toast.error(apiError(err).error);
    }
  }

  protected async remove(todo: Todo): Promise<void> {
    try {
      await this.store.remove(todo.id);
      toast(`Deleted “${todo.title.length > 40 ? todo.title.slice(0, 40) + '…' : todo.title}”`);
    } catch (err) {
      toast.error(apiError(err).error);
    }
  }

  protected async clearDone(): Promise<void> {
    const n = this.store.board().done.length;
    if (!confirm(`Delete ${n} task${n === 1 ? '' : 's'} in Done?`)) return;
    try {
      const removed = await this.store.clearDone();
      toast(`Removed ${removed} done task${removed === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(apiError(err).error);
    }
  }
}
