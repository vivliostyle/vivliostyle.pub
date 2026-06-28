import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { createApiMiddleware } from '../middleware';

const MESSAGE_SYNC = 0;

async function register(baseUrl: string, username: string) {
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  });
  const signIn = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  });
  const { token: sessionToken } = (await signIn.json()) as { token: string };
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'c',
    redirect_uri: 'http://r',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
  }).toString();
  const authorize = await fetch(
    `${baseUrl}/api/auth/oauth2/authorize?${query}`,
    { headers: { Authorization: `Bearer ${sessionToken}` } },
  );
  const { url } = (await authorize.json()) as { url: string };
  const code = new URL(url).searchParams.get('code');
  const tokenRes = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code as string,
      code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      redirect_uri: 'http://r',
      client_id: 'c',
    }).toString(),
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  return access_token;
}

async function createProject(baseUrl: string, token: string) {
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: 'Test' }),
  });
  return ((await res.json()) as { id: string }).id;
}

function decodeIncoming(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
  }
  throw new Error(`unexpected ws data type: ${typeof data}`);
}

describe('sync WebSocket', () => {
  let dispose: () => Promise<void>;
  let baseUrl: string;
  let wsBase: string;

  beforeEach(async () => {
    const api = createApiMiddleware();
    const http = createServer((req, res) => {
      api.middleware(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    api.injectWebSocket(http);
    await new Promise<void>((resolve) =>
      http.listen(0, '127.0.0.1', () => resolve()),
    );
    const { port } = http.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    dispose = async () => {
      await new Promise<void>((resolve, reject) =>
        http.close((err) => (err ? reject(err) : resolve())),
      );
      api.close();
    };
  });

  afterEach(async () => {
    await dispose();
  });

  it('broadcasts updates from one client to another', async () => {
    const token = await register(baseUrl, 'alice');
    const projectId = await createProject(baseUrl, token);
    const path = `/api/projects/${projectId}/sync-ws/chapter.md?access_token=${token}`;

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const wsA = new WebSocket(`${wsBase}${path}`);
    const wsB = new WebSocket(`${wsBase}${path}`);
    wsA.binaryType = 'arraybuffer';
    wsB.binaryType = 'arraybuffer';

    const wireUp = (ws: WebSocket, doc: Y.Doc) => {
      const wsOrigin = ws;
      ws.addEventListener('message', (evt) => {
        const bytes = decodeIncoming(evt.data);
        const decoder = decoding.createDecoder(bytes);
        if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, reply, doc, wsOrigin);
        if (encoding.length(reply) > 1) {
          ws.send(encoding.toUint8Array(reply));
        }
      });
      ws.addEventListener('open', () => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(enc, doc);
        ws.send(encoding.toUint8Array(enc));
      });
      // Local edits must be forwarded over the WS — that is what the real
      // client (WebSocketSyncProvider) does.
      doc.on('update', (update, origin) => {
        if (origin === wsOrigin) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        ws.send(encoding.toUint8Array(enc));
      });
    };
    wireUp(wsA, docA);
    wireUp(wsB, docB);

    await Promise.all([
      new Promise<void>((r) =>
        wsA.addEventListener('open', () => r(), { once: true }),
      ),
      new Promise<void>((r) =>
        wsB.addEventListener('open', () => r(), { once: true }),
      ),
    ]);
    // Give the initial sync round-trip time to settle.
    await new Promise((r) => setTimeout(r, 50));

    const bReceived = new Promise<void>((resolve) => {
      docB.getText('body').observe(() => {
        if (docB.getText('body').toString().includes('from A')) resolve();
      });
    });

    docA.getText('body').insert(0, 'from A');

    await Promise.race([
      bReceived,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('docB did not receive update')), 1000),
      ),
    ]);
    expect(docB.getText('body').toString()).toBe('from A');

    wsA.close();
    wsB.close();
  });
});
