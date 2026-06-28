import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { HttpPollingSyncProvider } from './http-polling-provider';
import type { SyncTransport } from './types';

function serverTransport(serverDoc: Y.Doc): SyncTransport {
  return {
    async syncPull(_projectId, _filename, stateVector) {
      return Y.encodeStateAsUpdate(serverDoc, stateVector);
    },
    async syncPush(_projectId, _filename, update, stateVector) {
      if (update.byteLength > 0) {
        Y.applyUpdate(serverDoc, update);
      }
      return Y.encodeStateAsUpdate(serverDoc, stateVector);
    },
  };
}

const NEVER = 1_000_000;

describe('HttpPollingSyncProvider', () => {
  it('pushes local changes and pulls remote changes', async () => {
    const serverDoc = new Y.Doc();
    const transport = serverTransport(serverDoc);

    const docA = new Y.Doc();
    docA.getText('t').insert(0, 'from A');
    const a = new HttpPollingSyncProvider({
      transport,
      projectId: 'p',
      filename: 'f.md',
      doc: docA,
      intervalMs: NEVER,
    });
    await a.connect();
    expect(serverDoc.getText('t').toString()).toBe('from A');

    const docB = new Y.Doc();
    const b = new HttpPollingSyncProvider({
      transport,
      projectId: 'p',
      filename: 'f.md',
      doc: docB,
      intervalMs: NEVER,
    });
    await b.connect();
    expect(docB.getText('t').toString()).toBe('from A');

    docB.getText('t').insert(6, ' and B');
    await b.sync();
    expect(serverDoc.getText('t').toString()).toBe('from A and B');

    await a.sync();
    expect(docA.getText('t').toString()).toBe('from A and B');

    a.disconnect();
    b.disconnect();
    expect(a.status).toBe('disconnected');
  });

  it('reports connected status after a successful sync', async () => {
    const provider = new HttpPollingSyncProvider({
      transport: serverTransport(new Y.Doc()),
      projectId: 'p',
      filename: 'f.md',
      doc: new Y.Doc(),
      intervalMs: NEVER,
    });
    await provider.connect();
    expect(provider.status).toBe('connected');
    provider.disconnect();
  });

  it('skips the round trip on idle interval ticks and resumes after a local edit', async () => {
    vi.useFakeTimers();
    try {
      let pushCalls = 0;
      const serverDoc = new Y.Doc();
      const transport: SyncTransport = {
        async syncPull(_projectId, _filename, stateVector) {
          return Y.encodeStateAsUpdate(serverDoc, stateVector);
        },
        async syncPush(_projectId, _filename, update, stateVector) {
          pushCalls++;
          if (update.byteLength > 0) {
            Y.applyUpdate(serverDoc, update);
          }
          return Y.encodeStateAsUpdate(serverDoc, stateVector);
        },
      };

      const doc = new Y.Doc();
      const provider = new HttpPollingSyncProvider({
        transport,
        projectId: 'p',
        filename: 'f.md',
        doc,
        intervalMs: 1000,
      });
      await provider.connect();
      const afterConnect = pushCalls;

      // Idle: several interval ticks elapse with no local changes.
      await vi.advanceTimersByTimeAsync(5000);
      expect(pushCalls).toBe(afterConnect);

      // A local edit re-arms the poll loop.
      doc.getText('t').insert(0, 'edit');
      await vi.advanceTimersByTimeAsync(1000);
      expect(pushCalls).toBe(afterConnect + 1);
      expect(serverDoc.getText('t').toString()).toBe('edit');

      // Idle again afterwards.
      await vi.advanceTimersByTimeAsync(5000);
      expect(pushCalls).toBe(afterConnect + 1);

      provider.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-queues local changes when a push fails', async () => {
    let fail = true;
    const serverDoc = new Y.Doc();
    const transport: SyncTransport = {
      async syncPull(_projectId, _filename, stateVector) {
        return Y.encodeStateAsUpdate(serverDoc, stateVector);
      },
      async syncPush(_projectId, _filename, update, stateVector) {
        if (fail) {
          throw new Error('network down');
        }
        if (update.byteLength > 0) {
          Y.applyUpdate(serverDoc, update);
        }
        return Y.encodeStateAsUpdate(serverDoc, stateVector);
      },
    };

    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'queued');
    const provider = new HttpPollingSyncProvider({
      transport,
      projectId: 'p',
      filename: 'f.md',
      doc,
      intervalMs: NEVER,
    });
    await expect(provider.connect()).rejects.toThrow();
    expect(provider.status).toBe('error');

    fail = false;
    await provider.sync();
    expect(serverDoc.getText('t').toString()).toBe('queued');
    provider.disconnect();
  });
});
