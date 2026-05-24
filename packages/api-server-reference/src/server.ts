import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';

import { createApp } from './app';
import { toArrayBuffer } from './route-helpers';

const MESSAGE_SYNC = 0;

function messageToUint8Array(
  data: string | Blob | ArrayBufferLike,
): Uint8Array | undefined {
  if (typeof data === 'string' || data instanceof Blob) {
    return undefined;
  }
  return new Uint8Array(data as ArrayBuffer);
}

const { app, deps } = createApp();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Realtime Yjs sync. Browsers cannot set the Authorization header on a
// WebSocket handshake, so the access token is passed as a query parameter.
app.get(
  '/projects/:id/sync/ws',
  upgradeWebSocket((c) => {
    const projectId = c.req.param('id') ?? '';
    const token = c.req.query('access_token');
    let authorized = false;
    let unsubscribe = () => {};
    return {
      onOpen(_evt, ws) {
        const accessToken = token
          ? deps.store.findAccessToken(token)
          : undefined;
        if (
          !accessToken ||
          accessToken.expiresAt < Date.now() ||
          !deps.store.getProject(accessToken.userId, projectId)
        ) {
          ws.close(1008, 'unauthorized');
          return;
        }
        authorized = true;
        const doc = deps.docs.get(projectId);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(encoder, doc);
        ws.send(toArrayBuffer(encoding.toUint8Array(encoder)));
        unsubscribe = deps.docs.subscribe(projectId, (update, origin) => {
          if (origin === ws) {
            return;
          }
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.writeUpdate(enc, update);
          ws.send(toArrayBuffer(encoding.toUint8Array(enc)));
        });
      },
      onMessage(evt, ws) {
        if (!authorized) {
          return;
        }
        const bytes = messageToUint8Array(evt.data);
        if (!bytes) {
          return;
        }
        const decoder = decoding.createDecoder(bytes);
        const messageType = decoding.readVarUint(decoder);
        if (messageType === MESSAGE_SYNC) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(
            decoder,
            encoder,
            deps.docs.get(projectId),
            ws,
          );
          if (encoding.length(encoder) > 1) {
            ws.send(toArrayBuffer(encoding.toUint8Array(encoder)));
          }
        }
      },
      onClose() {
        unsubscribe();
      },
    };
  }),
);

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `@v/api-server-reference listening on http://localhost:${info.port}`,
  );
});
injectWebSocket(server);
