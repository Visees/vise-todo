import { ChangeDetectionStrategy, Component, Injectable, computed, effect, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { AuthService } from '../core/auth.service';
import { apiError } from '../core/auth';
import { ListsStore } from '../core/lists.store';
import type { TodoList } from '../core/models';
import { ThemeService, type ThemeChoice } from '../core/theme.service';
import { TodosStore } from '../core/todos.store';
import { PasswordDialog } from '../features/account/password-dialog';
import { ListDialog, type ListDialogData } from '../features/lists/list-dialog';
import { BrandMark } from './brand-mark';

/** Lets pages open the sidebar drawer on phones. */
@Injectable()
export class ShellState {
  readonly drawerOpen = signal(false);
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIcon, HlmButtonImports, BrandMark],
  providers: [ShellState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full', '(document:keydown.escape)': 'state.drawerOpen.set(false)' },
  template: `
    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-2.5 py-3.5 transition-transform md:static md:translate-x-0"
      [class.-translate-x-full]="!state.drawerOpen()"
    >
      <app-brand-mark class="px-1.5 pt-0.5 pb-4" />

      <!-- Scrolls on its own when there are many lists, so the account footer stays in view. -->
      <nav aria-label="Main" class="-mx-2.5 min-h-0 flex-1 overflow-y-auto px-2.5">
        <div class="flex items-center pr-1 pb-1.5 pl-2.5">
          <span class="text-[11px] font-medium text-muted-foreground">Lists</span>
          <button hlmBtn variant="ghost" size="icon-xs" class="ml-auto" type="button" title="New list" aria-label="New list" (click)="newList()">
            <ng-icon name="lucidePlus" />
          </button>
        </div>
        @for (list of lists.lists(); track list.id) {
          <a
            [routerLink]="['/lists', list.id]"
            routerLinkActive="border-border! bg-background! text-foreground! shadow-xs"
            ariaCurrentWhenActive="page"
            (click)="state.drawerOpen.set(false)"
            class="mb-0.5 flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ng-icon name="lucideKanban" size="16" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ list.name }}</span>
            <span class="text-xs text-muted-foreground tabular-nums" title="Open tasks">{{ list.openTasks || '' }}</span>
          </a>
        }
        @if (auth.user()?.role === 'admin') {
          <div class="px-2.5 pt-4 pb-1.5 text-[11px] font-medium text-muted-foreground">Admin</div>
          <a
            routerLink="/admin/users"
            routerLinkActive="border-border! bg-background! text-foreground! shadow-xs"
            ariaCurrentWhenActive="page"
            (click)="state.drawerOpen.set(false)"
            class="mb-0.5 flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ng-icon name="lucideUsers" size="16" />
            Users
          </a>
        }
      </nav>

      <!-- minmax(0, 1fr): an auto column would grow to fit the full email and push past the sidebar. -->
      <div class="mt-auto grid grid-cols-[minmax(0,1fr)] gap-2.5 border-t border-sidebar-border pt-3">
        <div class="grid grid-cols-3 rounded-md border border-border bg-muted p-0.5" role="group" aria-label="Theme">
          @for (option of themes; track option.value) {
            <button
              type="button"
              class="cursor-pointer rounded py-1 text-xs font-medium text-muted-foreground"
              [class]="theme.choice() === option.value ? 'bg-background! text-foreground! shadow-xs' : ''"
              [attr.aria-pressed]="theme.choice() === option.value"
              (click)="theme.set(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
        <div class="flex items-center gap-2.5 px-1">
          <span class="grid size-7 shrink-0 place-items-center rounded-full bg-divider text-xs font-semibold text-body">{{ initials() }}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13px] font-medium text-foreground">{{ auth.user()?.name }}</div>
            <div class="truncate text-xs text-muted-foreground">{{ auth.user()?.email }}</div>
          </div>
          <button hlmBtn variant="ghost" size="icon-sm" type="button" title="Change password" aria-label="Change password" (click)="changePassword()">
            <ng-icon name="lucideKeyRound" size="16" />
          </button>
          <button hlmBtn variant="ghost" size="icon-sm" type="button" title="Sign out" aria-label="Sign out" (click)="logout()">
            <ng-icon name="lucideLogOut" size="16" />
          </button>
        </div>
      </div>
    </aside>

    @if (state.drawerOpen()) {
      <div class="fixed inset-0 z-30 bg-black/35 md:hidden" (click)="state.drawerOpen.set(false)"></div>
    }

    <main class="flex min-w-0 flex-1 flex-col overflow-auto">
      <router-outlet />
    </main>
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly state = inject(ShellState);
  protected readonly store = inject(TodosStore);
  protected readonly lists = inject(ListsStore);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  protected readonly themes: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  protected readonly initials = computed(() =>
    (this.auth.user()?.name ?? '')
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
  );

  constructor() {
    this.store.loadMembers().catch((err) => toast.error(apiError(err).error));
    void this.lists.ready();
    effect(() => {
      const id = this.store.listId();
      if (id !== null && this.store.loaded()) this.lists.setOpenTasks(id, this.store.openCount());
    });
  }

  protected newList(): void {
    this.state.drawerOpen.set(false);
    this.dialog
      .open<ListDialog, ListDialogData, TodoList>(ListDialog, { width: '420px', maxWidth: 'calc(100vw - 32px)', restoreFocus: true })
      .afterClosed()
      .subscribe((list) => {
        if (list) void this.router.navigate(['/lists', list.id]);
      });
  }

  protected changePassword(): void {
    this.state.drawerOpen.set(false);
    this.dialog
      .open<PasswordDialog, void, boolean>(PasswordDialog, { width: '420px', maxWidth: 'calc(100vw - 32px)', restoreFocus: true })
      .afterClosed()
      .subscribe((changed) => {
        if (changed) toast('Password changed. Your other devices were signed out.');
      });
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.store.reset();
    this.lists.reset();
    await this.router.navigateByUrl('/login');
  }
}
