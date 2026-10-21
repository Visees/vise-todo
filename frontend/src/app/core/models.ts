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

/** Someone a task can be assigned to. */
export interface Member {
  id: number;
  name: string;
}

export type Status = 'todo' | 'doing' | 'done';

export interface Todo {
  id: number;
  /** Who created it. */
  ownerId: number;
  title: string;
  /** The board column. */
  status: Status;
  /** Order inside the column, 0 = top. */
  position: number;
  /** 'YYYY-MM-DD' in the user's calendar, or null. */
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Also shows the card on this person's board. */
  assignee: Member | null;
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
