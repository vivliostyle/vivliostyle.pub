import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';

import { createApp } from './app';
import { registerSyncWebSocket } from './sync-websocket';

const { app, deps } = createApp();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

registerSyncWebSocket(app, deps, upgradeWebSocket);

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `@v/api-server-reference listening on http://localhost:${info.port}`,
  );
});
injectWebSocket(server);
