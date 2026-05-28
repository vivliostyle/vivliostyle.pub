import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { WebSocketSyncProvider } from './websocket-provider';

const MESSAGE_SYNC = 0;

/** Process a client sync message against the server doc, y-websocket style. */
function serverProcess(
  serverDoc: Y.Doc,
  incoming: Uint8Array,
): Uint8Array | null {
  const decoder = decoding.createDecoder(incoming);
  if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) {
    return null;
  }
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.readSyncMessage(decoder, encoder, serverDoc, 'server');
  return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null;
}

function makeFakeWebSocket(serverDoc: Y.Doc) {
  return class FakeWebSocket {
    static readonly OPEN = 1;
    binaryType = 'blob';
    readyState = 0;
    private readonly listeners: Record<string, Set<(event: unknown) => void>> =
      {};

    constructor(readonly url: string) {
      setTimeout(() => {
        this.readyState = 1;
        this.emit('open', {});
      }, 0);
    }

    addEventListener(type: string, cb: (event: unknown) => void): void {
      const set = this.listeners[type] ?? new Set();
      this.listeners[type] = set;
      set.add(cb);
    }

    removeEventListener(type: string, cb: (event: unknown) => void): void {
      this.listeners[type]?.delete(cb);
    }

    private emit(type: string, event: unknown): void {
      for (const cb of this.listeners[type] ?? []) {
        cb(event);
      }
    }

    send(data: ArrayBufferView | ArrayBuffer | string): void {
      const bytes =
        data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      const reply = serverProcess(serverDoc, bytes);
      if (reply) {
        const buffer = reply.buffer.slice(
          reply.byteOffset,
          reply.byteOffset + reply.byteLength,
        );
        this.emit('message', { data: buffer });
      }
    }

    close(): void {
      this.readyState = 3;
      this.emit('close', {});
    }
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WebSocketSyncProvider', () => {
  it('syncs server content to the client and client edits to the server', async () => {
    const serverDoc = new Y.Doc();
    serverDoc.getText('t').insert(0, 'server content');
    const FakeWebSocket = makeFakeWebSocket(serverDoc);

    const clientDoc = new Y.Doc();
    const provider = new WebSocketSyncProvider({
      url: 'ws://sync.example/p/ws',
      doc: clientDoc,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });

    await provider.connect();
    await tick();
    expect(provider.status).toBe('connected');
    expect(clientDoc.getText('t').toString()).toBe('server content');

    clientDoc.getText('t').insert(0, 'X ');
    await tick();
    expect(serverDoc.getText('t').toString()).toBe('X server content');

    provider.disconnect();
    expect(provider.status).toBe('disconnected');
  });
});
