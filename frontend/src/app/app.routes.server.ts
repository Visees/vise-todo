import { RenderMode, type ServerRoute } from '@angular/ssr';

/**
 * Everything sits behind a login, so the browser renders it: there is no public page
 * for crawlers. The server still serves the shell, assets and the /api proxy.
 */
export const serverRoutes: ServerRoute[] = [{ path: '**', renderMode: RenderMode.Client }];
