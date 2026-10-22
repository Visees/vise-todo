import type { Todo } from './models';

export function isoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export const today = () => isoDay(new Date());

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

export function formatDue(iso: string): string {
  if (iso === today()) return 'Today';
  if (iso === addDays(1)) return 'Tomorrow';
  if (iso === addDays(-1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y!, m! - 1, d).toLocaleDateString(undefined, opts);
}

export type DueBadge = { variant: 'late' | 'wait' | 'neutral'; text: string };

/** Due date as a badge: text + colour, so the state never depends on colour alone. */
export function dueBadge(todo: Todo): DueBadge | null {
  if (!todo.dueDate) return null;
  const text = formatDue(todo.dueDate);
  if (todo.done) return { variant: 'neutral', text };
  const now = today();
  if (todo.dueDate < now) return { variant: 'late', text: `Overdue · ${text}` };
  if (todo.dueDate === now) return { variant: 'wait', text: 'Due today' };
  return { variant: 'neutral', text };
}

export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none';

export function matchesDue(todo: Todo, filter: DueFilter): boolean {
  const due = todo.dueDate;
  switch (filter) {
    case 'overdue':
      return !!due && due < today() && !todo.done;
    case 'today':
      return due === today();
    case 'week':
      return !!due && due >= today() && due <= addDays(7);
    case 'none':
      return !due;
    default:
      return true;
  }
}
