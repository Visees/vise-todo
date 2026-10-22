import type { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/auth';
import { lastListGuard, listGuard } from './core/lists.store';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], title: 'Sign in · Todo', loadComponent: () => import('./features/login/login').then((m) => m.Login) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      // /board only picks a list; the board itself lives at /lists/:listId.
      { path: 'board', canActivate: [lastListGuard], children: [] },
      {
        path: 'lists/:listId',
        canActivate: [listGuard],
        // No route title: the board sets the list's name, and keeps it current on rename.
        loadComponent: () => import('./features/board/board').then((m) => m.Board),
      },
      {
        path: 'admin/users',
        canActivate: [adminGuard],
        title: 'Users · Todo',
        loadComponent: () => import('./features/admin/users-page').then((m) => m.UsersPage),
      },
    ],
  },
  { path: '**', redirectTo: 'board' },
];
