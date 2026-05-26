import { EventEmitter } from 'node:events';
import type {
  Server as HttpServer,
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import type { Http2SecureServer, Http2Server } from 'node:http2';
import type { Duplex } from 'node:stream';
import { getRequestListener } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';

import { type CreateAppOptions, createApp } from './app';
import { FileStore } from './storage/file-store';
import { SqliteStore } from './storage/sqlite-store';
import { registerSyncWebSocket } from './sync/websocket';

/**
 * Matches what `@hono/node-ws#injectWebSocket` accepts, which also covers
 * what Vite exposes as `server.httpServer` (HTTPS dev mode uses an
 * Http2SecureServer).
 */
type AnyHttpServer = HttpServer | Http2Server | Http2SecureServer;

export interface CreateApiDevServerOptions extends CreateAppOptions {
  /**
   * Path prefix the API is mounted under on the host dev server.
   *
   * The prefix is stripped from request URLs before forwarding to Hono so the
   * routes inside the API stay identical between dev embedding and production.
   * Defaults to `/api`. Trailing slashes are normalized away.
   */
  basePath?: string;
  /**
   * SQLite database path. When set, the dev server persists data to disk;
   * when omitted, the default in-memory SQLite database is used (lost on
   * restart). Ignored if `store` is supplied explicitly.
   */
  sqlitePath?: string;
  /** Forwarded to `FileStore`. Ignored if `files` is supplied explicitly. */
  projectFilePath?: string;
}

export interface ApiDevServer {
  /** The normalized base path the dev server is mounted under. */
  basePath: string;
  /**
   * Connect-style middleware (compatible with `vite`'s `server.middlewares`)
   * that handles requests under `basePath`. Other requests fall through.
   */
  middleware: (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => void;
  /** Attach the WebSocket upgrade handler to the given http server. */
  injectWebSocket: (server: AnyHttpServer) => void;
  /**
   * Release resources owned by this instance. Currently closes the SQLite
   * connection so hot-reloading the API module (which builds a fresh
   * `ApiDevServer`) does not accumulate open database handles.
   */
  close: () => void;
}

/**
 * Build an embeddable dev server for the reference API. Returned helpers can
 * be wired into any Node http server (e.g. Vite's `server.httpServer`) so the
 * app and API share a single origin during local development.
 */
export function createApiDevServer(
  options: CreateApiDevServerOptions = {},
): ApiDevServer {
  const {
    basePath: rawBasePath = '/api',
    sqlitePath,
    projectFilePath,
    ...appOptions
  } = options;
  const basePath = rawBasePath.replace(/\/+$/, '') || '/';
  const store = appOptions.store ?? new SqliteStore({ path: sqlitePath });
  const files =
    appOptions.files ?? new FileStore({ basePath: projectFilePath });
  const { app, deps } = createApp({ ...appOptions, store, files });
  const { injectWebSocket: honoInjectWebSocket, upgradeWebSocket } =
    createNodeWebSocket({ app });
  registerSyncWebSocket(app, deps, upgradeWebSocket);

  const listener = getRequestListener(app.fetch);

  const matchesBasePath = (url: string | undefined): url is string =>
    typeof url === 'string' &&
    (basePath === '/' ||
      url === basePath ||
      url.startsWith(`${basePath}/`) ||
      url.startsWith(`${basePath}?`));

  const stripBasePath = (url: string): string => {
    if (basePath === '/') return url;
    const stripped = url.slice(basePath.length);
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  };

  return {
    basePath,
    middleware(req, res, next) {
      if (!matchesBasePath(req.url)) {
        next();
        return;
      }
      req.url = stripBasePath(req.url);
      listener(req, res);
    },
    injectWebSocket(httpServer) {
      // `@hono/node-ws` attaches its upgrade handler via `server.on('upgrade')`
      // but its URL parser does not know about our base path. Route through a
      // proxy EventEmitter so we can rewrite the request URL before hono-ws
      // matches the route, while only consuming upgrades destined for the API.
      const proxy = new EventEmitter();
      honoInjectWebSocket(proxy as unknown as HttpServer);
      httpServer.on(
        'upgrade',
        (req: IncomingMessage, socket: Duplex, head: Buffer) => {
          if (!matchesBasePath(req.url)) return;
          req.url = stripBasePath(req.url);
          proxy.emit('upgrade', req, socket, head);
        },
      );
    },
    close() {
      store.close();
    },
  };
}
