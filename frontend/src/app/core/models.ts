export type Role = 'admin' | 'member';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

/** A row on the admin Users page. */
export interface ManagedUser extends User {
  createdAt: string;
  openTasks: number;
  totalTasks: number;
}

export type Status = 'todo' | 'doing' | 'done';

export interface Todo {
  id: number;
  title: string;
  /** The board column. */
  status: Status;
  /** Order inside the column, 0 = top. */
  position: number;
  /** 'YYYY-MM-DD' in the user's calendar, or null. */
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To do' },
  { status: 'doing', title: 'In progress' },
  { status: 'done', title: 'Done' },
];

/** The `{ error, field? }` body every API error returns. */
export interface ApiError {
  error: string;
  field?: string;
}
