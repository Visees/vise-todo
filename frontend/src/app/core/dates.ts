import type { Todo, TaskView } from './models';

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

export function formatDue(iso: string | null): string {
  if (!iso) return '—';
  if (iso === today()) return 'Today';
  if (iso === addDays(1)) return 'Tomorrow';
  if (iso === addDays(-1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y!, m! - 1, d).toLocaleDateString(undefined, opts);
}

export type Status = { variant: 'ok' | 'late' | 'wait' | 'neutral'; text: string };

export function statusOf(todo: Todo): Status {
  if (todo.done) return { variant: 'ok', text: 'Done' };
  const now = today();
  if (todo.dueDate && todo.dueDate < now) return { variant: 'late', text: 'Overdue' };
  if (todo.dueDate === now) return { variant: 'wait', text: 'Due today' };
  return { variant: 'neutral', text: 'Open' };
}

export function inView(todo: Todo, view: TaskView): boolean {
  const now = today();
  switch (view) {
    case 'today':
      return !todo.done && !!todo.dueDate && todo.dueDate <= now;
    case 'upcoming':
      return !todo.done && !!todo.dueDate && todo.dueDate > now;
    case 'done':
      return todo.done;
    default:
      return true;
  }
}
