import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';

import { createApp } from './app';
import { FileStore } from './file-store';
import { SqliteStore } from './store';
import { registerSyncWebSocket } from './sync-websocket';

// When either env var is unset the corresponding store falls back to in-memory
// (SQLite `:memory:`, `@platformatic/vfs`'s `MemoryProvider`) and the data is
// lost at shutdown — fine for ad-hoc local runs, never for a real deployment.
const sqlitePath = process.env.API_SQLITE_PATH;
const projectFilePath = process.env.API_PROJECT_FILE_PATH;
const store = new SqliteStore({ path: sqlitePath });
const files = new FileStore({ basePath: projectFilePath });

const { app, deps } = createApp({ store, files });
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

registerSyncWebSocket(app, deps, upgradeWebSocket);

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `@v/api-server-reference listening on http://localhost:${info.port}`,
  );
  console.log(`  metadata: sqlite (${sqlitePath ?? ':memory:'})`);
  console.log(`  files:    ${projectFilePath ?? ':memory: (vfs)'}`);
});
injectWebSocket(server);
