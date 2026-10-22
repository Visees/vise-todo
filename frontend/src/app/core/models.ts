export type Role = 'admin' | 'member';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  /** Their board shows every card, not only their own and the ones assigned to them. */
  seeAllTasks: boolean;
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

/** A named board. Everyone sees every list; the cards in it follow the usual visibility. */
export interface TodoList {
  id: number;
  name: string;
  /** Null for the first list, made before lists existed. Only its creator or an admin can delete it. */
  createdBy: number | null;
  /** Open cards in it that this user sees. */
  openTasks: number;
}

export type Status = 'todo' | 'doing' | 'done';

export interface Todo {
  id: number;
  /** Who created it. */
  ownerId: number;
  /** The list (board) it is on. */
  listId: number;
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
