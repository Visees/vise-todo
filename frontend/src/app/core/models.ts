export interface User {
  id: number;
  email: string;
  name: string;
}

export interface Todo {
  id: number;
  title: string;
  done: boolean;
  /** 'YYYY-MM-DD' in the user's calendar, or null. */
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type TaskView = 'all' | 'today' | 'upcoming' | 'done';

export const TASK_VIEWS: Record<TaskView, { title: string; sub: string; icon: string }> = {
  all: { title: 'All tasks', sub: 'Everything on your list.', icon: 'lucideInbox' },
  today: { title: 'Today', sub: 'Due today or overdue.', icon: 'lucideCalendar' },
  upcoming: { title: 'Upcoming', sub: 'Open tasks with a due date ahead.', icon: 'lucideClock' },
  done: { title: 'Completed', sub: 'Tasks you have finished.', icon: 'lucideCircleCheck' },
};

/** The `{ error, field? }` body every API error returns. */
export interface ApiError {
  error: string;
  field?: string;
}
