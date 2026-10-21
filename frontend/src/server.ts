import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { join } from 'node:path';

/**
 * Frontend server (one origin for the browser):
 *  - static files from /browser (long cache for hashed assets)
 *  - /api proxied to the api container
 *  - security headers, robots.txt, /healthz
 *  - every route renders in the browser (see app.routes.server.ts)
 */
const browserDistFolder = join(import.meta.dirname, '../browser');
const API_URL = process.env['API_INTERNAL_URL'] || 'http://localhost:3000';
const SITE_URL = (process.env['SITE_URL'] || 'http://localhost:4000').replace(/\/$/, '');

const FORWARDED = ['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-forwarded-port', 'x-forwarded-prefix'];
const angularApp = new AngularNodeAppEngine({
  allowedHosts: [new URL(SITE_URL).hostname, 'localhost', '127.0.0.1'],
  trustProxyHeaders: FORWARDED,
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Private app: nothing to index.
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

app.use(
  createProxyMiddleware({
    target: API_URL,
    changeOrigin: false,
    xfwd: true,
    pathFilter: '/api',
    proxyTimeout: 30_000,
  }),
);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // index.html applies the saved theme with a small inline script before the first paint.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  next();
});

app.use(
  express.static(browserDistFolder, {
    index: false,
    redirect: false,
    setHeaders: (res, path) => {
      // Build output is content-hashed (main-ME5CVFMJ.js, chunk-Bj6djJLu.js), so it never changes.
      if (/-[A-Za-z0-9_]{8}\.(js|css)$/.test(path) || /\.woff2?$/.test(path)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (/index\.csr\.html$/.test(path)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }),
);

app.use((req, res, next) => {
  // Traefik adds headers Angular does not know (X-Forwarded-Server); unknown
  // x-forwarded-* headers make the engine refuse the request, so drop them.
  for (const header of Object.keys(req.headers)) {
    if (header.startsWith('x-forwarded-') && !FORWARDED.includes(header)) delete req.headers[header];
  }
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number(process.env['PORT'] || 4000);
  app.listen(port, (error) => {
    if (error) throw error;
    console.log(`Frontend listening on http://localhost:${port} (api → ${API_URL})`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
