import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';

import { createApp } from './app';
import { SqliteStore } from './store';
import { registerSyncWebSocket } from './sync-websocket';

// SQLite is the only backing store. `API_SQLITE_PATH` selects a file path for
// persistence; if unset the database lives in memory and is lost at shutdown.
const sqlitePath = process.env.API_SQLITE_PATH;
const store = new SqliteStore({ path: sqlitePath });

const { app, deps } = createApp({ store });
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

registerSyncWebSocket(app, deps, upgradeWebSocket);

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `@v/api-server-reference listening on http://localhost:${info.port}`,
  );
  console.log(`  storage: sqlite (${sqlitePath ?? ':memory:'})`);
});
injectWebSocket(server);
