import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], title: 'Sign in · Todo', loadComponent: () => import('./features/login/login').then((m) => m.Login) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [{ path: 'board', title: 'Board · Todo', loadComponent: () => import('./features/board/board').then((m) => m.Board) }],
  },
  { path: '**', redirectTo: 'board' },
];
