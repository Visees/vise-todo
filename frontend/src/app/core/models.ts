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

/** A column of a list's board. Anyone can add, rename, reorder and (when empty) delete one. */
export interface BoardColumn {
  id: number;
  listId: number;
  name: string;
  /** Left to right, 0 = first. */
  position: number;
  /** Cards in it count as finished: no overdue warning, not in open counts, removed by Clear done. */
  done: boolean;
}

export interface Todo {
  id: number;
  /** Who created it. */
  ownerId: number;
  /** The list (board) it is on. */
  listId: number;
  /** The board column, in the same list. */
  columnId: number;
  /** Its column is a done column. */
  done: boolean;
  title: string;
  /** Order inside the column, 0 = top. */
  position: number;
  /** 'YYYY-MM-DD' in the user's calendar, or null. */
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Also shows the card on this person's board. */
  assignee: Member | null;
}

/** The `{ error, field? }` body every API error returns. */
export interface ApiError {
  error: string;
  field?: string;
}
