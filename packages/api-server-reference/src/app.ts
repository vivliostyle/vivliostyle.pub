import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { openAPIRouteHandler } from 'hono-openapi';

import { bearerAuth } from './auth-middleware';
import {
  type AuthEnv,
  type Deps,
  defaultConfig,
  type ServerConfig,
} from './deps';
import { FileStore } from './file-store';
import { openApiDocumentation } from './openapi';
import { attachmentRoutes } from './routes/attachments';
import { authRoutes } from './routes/auth';
import { fileRoutes } from './routes/files';
import { projectRoutes } from './routes/projects';
import { syncRoutes } from './routes/sync';
import { wellKnownRoutes } from './routes/well-known';
import { SqliteStore } from './store';
import { DocRegistry } from './sync-doc';

export interface CreateAppOptions {
  store?: SqliteStore;
  files?: FileStore;
  config?: Partial<ServerConfig>;
}

export function createApp(options: CreateAppOptions = {}) {
  // Default to a fresh in-memory SQLite database (lost on process exit).
  // Callers that want persistence pass an explicit `store` (e.g. a
  // file-backed `SqliteStore`).
  const store = options.store ?? new SqliteStore();
  const files = options.files ?? new FileStore();
  const config: ServerConfig = { ...defaultConfig, ...options.config };
  const docs = new DocRegistry(store);
  const deps: Deps = { store, files, docs, config };

  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
    }),
  );
  // Required for cross-origin-isolated (COEP credentialless) clients.
  app.use('*', async (c, next) => {
    await next();
    c.header('Cross-Origin-Resource-Policy', 'cross-origin');
  });

  app.route('/', wellKnownRoutes(deps));
  app.route('/', authRoutes(deps));

  // All project-scoped routes require a valid bearer token. Scoping the
  // middleware to the prefix (rather than `use('*')` inside each sub-app)
  // keeps it from leaking onto sibling routes such as `/openapi`.
  const requireBearer = bearerAuth(store);
  // The realtime WebSocket endpoint (/projects/:id/sync/ws, registered by the
  // Node entrypoint) authenticates with a query-string token because browsers
  // cannot set the Authorization header on a WebSocket handshake, so it must
  // bypass this header-based guard.
  const projectAuth = createMiddleware<AuthEnv>((c, next) =>
    c.req.path.endsWith('/sync/ws') ? next() : requireBearer(c, next),
  );
  app.use('/projects', projectAuth);
  app.use('/projects/*', projectAuth);
  app.route('/', projectRoutes(deps));
  app.route('/', fileRoutes(deps));
  app.route('/', attachmentRoutes(deps));
  app.route('/', syncRoutes(deps));

  app.get(
    '/openapi',
    openAPIRouteHandler(app, { documentation: openApiDocumentation() }),
  );

  return { app, deps };
}
