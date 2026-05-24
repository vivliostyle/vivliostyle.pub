import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { openAPIRouteHandler } from 'hono-openapi';

import { bearerAuth } from './auth-middleware';
import { type Deps, defaultConfig, type ServerConfig } from './deps';
import { openApiDocumentation } from './openapi';
import { attachmentRoutes } from './routes/attachments';
import { authRoutes } from './routes/auth';
import { fileRoutes } from './routes/files';
import { projectRoutes } from './routes/projects';
import { syncRoutes } from './routes/sync';
import { wellKnownRoutes } from './routes/well-known';
import { InMemoryStore, type Store } from './store';
import { DocRegistry } from './sync-doc';

export interface CreateAppOptions {
  store?: Store;
  config?: Partial<ServerConfig>;
}

export function createApp(options: CreateAppOptions = {}) {
  const store = options.store ?? new InMemoryStore();
  const config: ServerConfig = { ...defaultConfig, ...options.config };
  const docs = new DocRegistry(store);
  const deps: Deps = { store, docs, config };

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
  app.use('/projects', bearerAuth(store));
  app.use('/projects/*', bearerAuth(store));
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
