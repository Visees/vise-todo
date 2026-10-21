import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import type { ApiError } from './models';

// inject() only works before the first await, so guards take what they need up front.
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  return auth.user() ? true : router.parseUrl('/login');
};

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  return auth.user() ? router.parseUrl('/board') : true;
};

/** A 401 from a data call means the session ended: go back to the login page. */
export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !req.url.startsWith('/api/auth/')) {
        auth.forget();
        void router.navigateByUrl('/login');
      }
      return throwError(() => err);
    }),
  );
};

/** The API's message for an error, or a generic one when the server is unreachable. */
export function apiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse && err.error && typeof err.error.error === 'string') {
    return err.error as ApiError;
  }
  return { error: 'Could not reach the server. Check your connection and try again.' };
}
