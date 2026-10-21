import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, signal, viewChild } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

export interface FilterOption {
  value: string;
  label: string;
}

let nextId = 0;

const POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];

/**
 * A filter pill that opens a list to pick from. The first option is the "no filter" value.
 * Type to narrow the list; arrows move, Enter picks, Escape closes.
 */
@Component({
  selector: 'app-filter-menu',
  imports: [CdkOverlayOrigin, CdkConnectedOverlay, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #trigger type="button" class="pill" cdkOverlayOrigin #origin="cdkOverlayOrigin" [class.pill-active]="value() !== options()[0]?.value"
      aria-haspopup="listbox" [attr.aria-expanded]="open()" (click)="toggle()">
      {{ label() }} <span class="text-foreground">{{ selected()?.label }}</span>
      <ng-icon name="lucideChevronDown" size="14" class="text-muted-foreground" />
    </button>

    <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions" (overlayOutsideClick)="close()" (detach)="close()">
      <div class="w-56 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg" (keydown)="onKey($event)">
        <div class="relative border-b border-border">
          <ng-icon name="lucideSearch" size="14" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-placeholder" />
          <input #search class="h-9 w-full bg-transparent pr-2.5 pl-8 text-[13px] outline-none! ring-0! placeholder:text-placeholder"
            [placeholder]="'Filter ' + label().toLowerCase()" autocomplete="off" spellcheck="false" role="combobox"
            aria-autocomplete="list" [attr.aria-controls]="listId" [attr.aria-activedescendant]="activeId()"
            [value]="query()" (input)="onQuery(search.value)" />
        </div>
        <ul [id]="listId" role="listbox" [attr.aria-label]="label()" class="max-h-64 overflow-y-auto p-1">
          @for (option of matches(); track option.value; let i = $index) {
            <li [id]="listId + '-' + i" role="option" [attr.aria-selected]="option.value === value()"
              class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px]"
              [class.bg-muted]="i === active()" (mouseenter)="active.set(i)" (click)="pick(option)">
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              @if (option.value === value()) {
                <ng-icon name="lucideCheck" size="14" class="shrink-0 text-foreground" />
              }
            </li>
          } @empty {
            <li class="px-2 py-3 text-center text-xs text-muted-foreground">No matches</li>
          }
        </ul>
      </div>
    </ng-template>
  `,
})
export class FilterMenu {
  readonly label = input.required<string>();
  readonly options = input.required<FilterOption[]>();
  readonly value = model.required<string>();

  protected readonly positions = POSITIONS;
  protected readonly listId = `filter-menu-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly active = signal(0);

  protected readonly selected = computed(() => this.options().find((o) => o.value === this.value()));
  protected readonly matches = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.options().filter((o) => o.label.toLowerCase().includes(q)) : this.options();
  });
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly activeId = computed(() => (this.matches().length ? `${this.listId}-${this.active()}` : null));

  protected toggle(): void {
    if (this.open()) return this.close();
    this.query.set('');
    this.active.set(Math.max(0, this.options().findIndex((o) => o.value === this.value())));
    this.open.set(true);
    // The overlay renders on the next tick; focus its search box so typing filters straight away.
    setTimeout(() => this.search()?.nativeElement.focus());
  }

  protected close(): void {
    this.open.set(false);
  }

  protected onQuery(text: string): void {
    this.query.set(text);
    this.active.set(0);
  }

  protected pick(option: FilterOption): void {
    this.value.set(option.value);
    this.close();
    this.trigger().nativeElement.focus();
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.matches().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!count) return;
      this.active.set((this.active() + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
      document.getElementById(`${this.listId}-${this.active()}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = this.matches()[this.active()];
      if (option) this.pick(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      this.trigger().nativeElement.focus();
    }
  }
}
