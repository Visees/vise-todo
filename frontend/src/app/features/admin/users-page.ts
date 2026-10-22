import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { apiError } from '../../core/auth';
import { initials } from '../../core/initials';
import { AuthService } from '../../core/auth.service';
import type { ManagedUser } from '../../core/models';
import { FilterMenu, type FilterOption } from '../../layout/filter-menu';
import { SidebarToggle } from '../../layout/shell';
import { UserDialog, type UserDialogData } from './user-dialog';
import { UsersStore } from './users.store';

const ROLE_OPTIONS: FilterOption[] = [
  { value: 'any', label: 'Any' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
];

const ACCESS_OPTIONS: FilterOption[] = [
  { value: 'any', label: 'Any' },
  { value: 'all', label: 'All tasks' },
  { value: 'own', label: 'Own tasks' },
];


@Component({
  selector: 'app-users-page',
  imports: [NgIcon, FilterMenu, SidebarToggle, HlmButtonImports, HlmInputImports, HlmBadgeImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-full flex-col' },
  template: `
    <header class="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 text-[13px] text-muted-foreground md:px-6">
      <app-sidebar-toggle />
      <span>Admin</span><span>/</span><span class="font-medium text-foreground">Users</span>
    </header>

    <div class="w-full max-w-[1040px] p-4 md:p-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-foreground">Users</h1>
          <p class="mt-0.5 text-[13px] text-muted-foreground">People who can sign in. Each user has their own board.</p>
        </div>
        <button hlmBtn type="button" class="h-10 px-3.5 shadow-xs md:h-9" (click)="openNew()">
          <ng-icon name="lucideUserPlus" size="16" /> New user
        </button>
      </div>

      <section class="overflow-hidden rounded-lg border border-border bg-card" aria-label="Users">
        <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <div class="relative min-w-[180px] flex-1 basis-full sm:max-w-80 sm:basis-auto">
            <ng-icon name="lucideSearch" size="14" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-placeholder" />
            <label class="sr-only" for="user-search">Search users</label>
            <input hlmInput id="user-search" class="h-8! pl-8 text-[13px]" placeholder="Search name or email" autocomplete="off"
              [value]="query()" (input)="query.set(value($event))" />
          </div>
          <app-filter-menu label="Role" [options]="roleOptions" [(value)]="role" />
          <app-filter-menu label="Sees" [options]="accessOptions" [(value)]="access" />
        </div>

        <!-- On phones the table scrolls sideways inside its frame; the page never does. -->
        <!-- relative: keeps the sr-only header label inside the scroll frame. -->
        <div class="relative overflow-x-auto">
          <table class="w-full min-w-[700px] text-[13px]">
            <thead class="border-b border-border bg-subtle text-left text-xs font-medium text-muted-foreground">
              <tr class="whitespace-nowrap [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium [&>th+th]:border-l [&>th+th]:border-divider">
                <th scope="col">Name</th>
                <th scope="col" class="min-w-44">Email</th>
                <th scope="col" class="w-24">Role</th>
                <th scope="col" class="w-24" title="Which tasks show on their board">Sees</th>
                <th scope="col" class="w-24 text-right">Open tasks</th>
                <th scope="col" class="w-28">Created</th>
                <th scope="col" class="w-20"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (user of rows(); track user.id) {
                <tr class="group border-b border-border transition-colors last:border-b-0 hover:bg-subtle [&>td]:px-3 [&>td]:py-2 [&>td+td]:border-l [&>td+td]:border-divider">
                  <td>
                    <div class="flex min-w-0 items-center gap-2.5">
                      <span class="grid size-7 shrink-0 place-items-center rounded-full bg-divider text-[11px] font-semibold text-body">{{ initials(user.name) }}</span>
                      <span class="truncate font-medium text-foreground">{{ user.name }}</span>
                      @if (user.id === me()?.id) {
                        <span class="text-xs text-muted-foreground">(you)</span>
                      }
                    </div>
                  </td>
                  <td class="max-w-0 truncate text-body">{{ user.email }}</td>
                  <td>
                    <span hlmBadge [variant]="user.role === 'admin' ? 'info' : 'neutral'">{{ user.role === 'admin' ? 'Admin' : 'Member' }}</span>
                  </td>
                  <td class="whitespace-nowrap" [class]="user.seeAllTasks ? 'text-foreground' : 'text-muted-foreground'">{{ user.seeAllTasks ? 'All tasks' : 'Own tasks' }}</td>
                  <td class="text-right text-body tabular-nums">{{ user.openTasks }}</td>
                  <td class="whitespace-nowrap text-body tabular-nums">{{ created(user.createdAt) }}</td>
                  <td>
                    <div class="flex justify-end gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      <button hlmBtn variant="ghost" size="icon-xs" type="button" title="Edit" [attr.aria-label]="'Edit ' + user.name" (click)="openEdit(user)">
                        <ng-icon name="lucidePencil" />
                      </button>
                      @if (user.id !== me()?.id) {
                        <button hlmBtn variant="ghost" size="icon-xs" type="button" title="Delete" class="hover:bg-late-surface hover:text-late"
                          [attr.aria-label]="'Delete ' + user.name" (click)="remove(user)">
                          <ng-icon name="lucideTrash2" />
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="px-4 py-12 text-center text-[13px] text-muted-foreground">
                    {{ store.loaded() ? 'No matching users' : 'Loading users…' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground tabular-nums">
          <span>{{ adminCount() }} admin{{ adminCount() === 1 ? '' : 's' }} · {{ store.users().length - adminCount() }} members</span>
          <span>{{ rows().length ? '1–' + rows().length + ' of ' + rows().length : '0 of 0' }}</span>
        </div>
      </section>
    </div>
  `,
})
export class UsersPage {
  protected readonly store = inject(UsersStore);
  private readonly dialog = inject(MatDialog);
  protected readonly me = inject(AuthService).user;

  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly accessOptions = ACCESS_OPTIONS;
  protected readonly initials = initials;
  protected readonly query = signal('');
  protected readonly role = signal<string>('any');
  protected readonly access = signal<string>('any');

  protected readonly adminCount = computed(() => this.store.users().filter((u) => u.role === 'admin').length);
  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const role = this.role();
    const access = this.access();
    return this.store
      .users()
      .filter(
        (u) =>
          (role === 'any' || u.role === role) &&
          (access === 'any' || u.seeAllTasks === (access === 'all')) &&
          (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
      );
  });

  constructor() {
    this.store.load().catch((err) => toast.error(apiError(err).error));
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected created(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected openNew(): void {
    this.open({});
  }

  protected openEdit(user: ManagedUser): void {
    this.open({ user, self: user.id === this.me()?.id });
  }

  private open(data: UserDialogData): void {
    this.dialog
      .open<UserDialog, UserDialogData, boolean>(UserDialog, { data, width: '480px', maxWidth: 'calc(100vw - 32px)', restoreFocus: true })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) toast(data.user ? `Saved ${data.user.name}` : 'User created');
      });
  }

  protected async remove(user: ManagedUser): Promise<void> {
    const tasks = user.totalTasks ? ` and their ${user.totalTasks} task${user.totalTasks === 1 ? '' : 's'}` : '';
    if (!confirm(`Delete ${user.name}${tasks}? This cannot be undone.`)) return;
    try {
      await this.store.remove(user.id);
      toast(`Deleted ${user.name}`);
    } catch (err) {
      toast.error(apiError(err).error);
    }
  }
}
