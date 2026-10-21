import { CdkDrag, CdkDragPlaceholder, CdkDropList, CdkDropListGroup, type CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { apiError } from '../../core/auth';
import { dueBadge, matchesDue, type DueFilter } from '../../core/dates';
import { COLUMNS, type Status, type Todo } from '../../core/models';
import { TodosStore } from '../../core/todos.store';
import { ShellState } from '../../layout/shell';
import { Autofocus } from '../../shared/autofocus';

const DUE_FILTERS: DueFilter[] = ['any', 'overdue', 'today', 'week', 'none'];
const DUE_LABEL: Record<DueFilter, string> = {
  any: 'Any',
  overdue: 'Overdue',
  today: 'Today',
  week: 'Next 7 days',
  none: 'No date',
};

@Component({
  selector: 'app-board',
  imports: [
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    NgIcon,
    HlmButtonImports,
    HlmInputImports,
    HlmBadgeImports,
    Autofocus,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-full flex-col', '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <header class="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 text-[13px] text-muted-foreground md:px-6">
      <button hlmBtn variant="ghost" size="icon-sm" class="-ml-1.5 md:hidden" aria-label="Open menu" (click)="shell.drawerOpen.set(true)">
        <ng-icon name="lucideMenu" size="18" />
      </button>
      <span>Tasks</span><span>/</span><span class="font-medium text-foreground">Board</span>
    </header>

    <div class="flex w-full flex-1 flex-col p-4 md:p-6">
      <div class="mb-[18px]">
        <h1 class="text-xl font-semibold text-foreground">Board</h1>
        <p class="mt-0.5 text-[13px] text-muted-foreground">Drag cards between columns, or move a focused card with Alt + arrow keys.</p>
      </div>

      <form class="mb-4 flex max-w-[760px] flex-wrap gap-2 md:flex-nowrap" (submit)="$event.preventDefault(); add()">
        <label class="sr-only" for="new-title">New task</label>
        <input #newTitle hlmInput id="new-title" class="basis-full md:basis-auto md:flex-1" placeholder="Add a task to To do" maxlength="500"
          autocomplete="off" [value]="draft()" (input)="draft.set(value($event))" />
        <label class="sr-only" for="new-due">Due date</label>
        <input hlmInput id="new-due" type="date" class="flex-1 tabular-nums md:w-40 md:flex-none" [value]="draftDue()"
          (input)="draftDue.set(value($event))" />
        <button hlmBtn type="submit" class="h-10 px-3.5 shadow-xs md:h-9" [disabled]="busy()">
          <ng-icon name="lucidePlus" size="16" /> Add task
        </button>
      </form>

      <div class="mb-3 flex flex-wrap items-center gap-2">
        <div class="relative min-w-[180px] flex-1 basis-full sm:max-w-80 sm:basis-auto">
          <ng-icon name="lucideSearch" size="14" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-placeholder" />
          <label class="sr-only" for="search">Search tasks</label>
          <input #search hlmInput id="search" class="!h-8 pr-14 pl-8 text-[13px]" placeholder="Search" autocomplete="off"
            [value]="query()" (input)="query.set(value($event))" />
          <span class="kbd absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline">Ctrl K</span>
        </div>
        <button type="button" class="pill" [class.pill-active]="due() !== 'any'" (click)="nextDue()">
          Due <span class="text-foreground">{{ dueLabel[due()] }}</span>
          <ng-icon name="lucideChevronDown" size="14" class="text-muted-foreground" />
        </button>
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
                title="Add task" (click)="quickAddIn.set(column.status)">
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
              @if (quickAddIn() === column.status) {
                <form (submit)="$event.preventDefault(); quickAdd(column.status, $event)">
                  <input hlmInput appAutofocus name="title" class="bg-card text-[13px]" maxlength="500" autocomplete="off"
                    [attr.aria-label]="'New task in ' + column.title" placeholder="Task title, then Enter"
                    (keydown.escape)="quickAddIn.set(null)" (blur)="quickAddBlur($event)" />
                </form>
              }

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
                      @if (editingId() === todo.id) {
                        <input hlmInput appAutofocus class="!h-7 px-2 text-[13px]" aria-label="Edit task" maxlength="500" [value]="todo.title"
                          (keydown)="$event.stopPropagation()"
                          (keydown.enter)="finishEdit(todo, $event, true)" (keydown.escape)="finishEdit(todo, $event, false)"
                          (blur)="finishEdit(todo, $event, true)" />
                      } @else {
                        <p class="text-[13px] leading-snug break-words" (dblclick)="editingId.set(todo.id)"
                          [class]="todo.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'">{{ todo.title }}</p>
                      }
                    </div>
                    <div class="-mt-0.5 -mr-1 flex shrink-0 gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      <button hlmBtn variant="ghost" size="icon-xs" type="button" title="Edit" [attr.aria-label]="'Edit: ' + todo.title"
                        (click)="editingId.set(todo.id)">
                        <ng-icon name="lucidePencil" />
                      </button>
                      <button hlmBtn variant="ghost" size="icon-xs" type="button" title="Delete" class="hover:bg-late-surface hover:text-late"
                        [attr.aria-label]="'Delete: ' + todo.title" (click)="remove(todo)">
                        <ng-icon name="lucideTrash2" />
                      </button>
                    </div>
                  </div>
                  @if (badge(todo); as b) {
                    <span hlmBadge class="mt-2 tabular-nums" [variant]="b.variant">{{ b.text }}</span>
                  }
                </article>
              } @empty {
                @if (quickAddIn() !== column.status) {
                  <p class="grid min-h-20 place-items-center rounded-md border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
                    {{ !store.loaded() ? 'Loading…' : filtering() ? 'No matching tasks' : 'Drop a card here' }}
                  </p>
                }
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
  protected readonly store = inject(TodosStore);
  protected readonly shell = inject(ShellState);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly columns = COLUMNS;
  protected readonly dueLabel = DUE_LABEL;
  protected readonly badge = dueBadge;

  protected readonly draft = signal('');
  protected readonly draftDue = signal('');
  protected readonly busy = signal(false);
  protected readonly query = signal('');
  protected readonly due = signal<DueFilter>('any');
  protected readonly editingId = signal<number | null>(null);
  protected readonly quickAddIn = signal<Status | null>(null);
  protected readonly announcement = signal('');

  private readonly newTitle = viewChild.required<ElementRef<HTMLInputElement>>('newTitle');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  protected readonly filtering = computed(() => !!this.query().trim() || this.due() !== 'any');

  protected readonly visible = computed(() => {
    const board = this.store.board();
    if (!this.filtering()) return board;
    const q = this.query().trim().toLowerCase();
    const keep = (t: Todo) => (!q || t.title.toLowerCase().includes(q)) && matchesDue(t, this.due());
    return { todo: board.todo.filter(keep), doing: board.doing.filter(keep), done: board.done.filter(keep) };
  });

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected nextDue(): void {
    this.due.set(DUE_FILTERS[(DUE_FILTERS.indexOf(this.due()) + 1) % DUE_FILTERS.length]!);
  }

  protected clearFilters(): void {
    this.query.set('');
    this.due.set('any');
  }

  protected onGlobalKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.search().nativeElement.focus();
      this.search().nativeElement.select();
    }
  }

  protected async add(): Promise<void> {
    const title = this.draft().trim();
    if (!title) {
      this.newTitle().nativeElement.focus();
      return;
    }
    this.busy.set(true);
    try {
      await this.store.add(title, this.draftDue() || null);
      this.draft.set('');
      this.draftDue.set('');
    } catch (err) {
      toast.error(apiError(err).error);
    } finally {
      this.busy.set(false);
      this.newTitle().nativeElement.focus();
    }
  }

  protected async quickAdd(status: Status, event: Event): Promise<void> {
    const input = (event.target as HTMLFormElement).elements.namedItem('title') as HTMLInputElement;
    const title = input.value.trim();
    if (!title) return;
    try {
      await this.store.add(title, null, status);
      input.value = '';
    } catch (err) {
      toast.error(apiError(err).error);
    }
  }

  protected quickAddBlur(event: FocusEvent): void {
    if (!(event.target as HTMLInputElement).value.trim()) this.quickAddIn.set(null);
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
      this.editingId.set(todo.id);
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

  protected async finishEdit(todo: Todo, event: Event, save: boolean): Promise<void> {
    if (this.editingId() !== todo.id) return;
    this.editingId.set(null);
    const title = (event.target as HTMLInputElement).value.trim();
    if (!save || !title || title === todo.title) return;
    try {
      await this.store.update(todo.id, { title });
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
