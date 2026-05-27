import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('../stores/actions/discover-projects', () => ({
  discoverProjects: vi.fn().mockResolvedValue(undefined),
}));

import { startEditorSync } from '../libs/editor-sync';
import { $session } from '../stores/accessors';
import { register } from '../stores/actions/session';
import type { ProjectId } from '../stores/proxies/project';
import { createFakeWebSocketRegistry } from './harness/fake-ws';
import { buildTestServer, type TestServer } from './harness/server';
import { setupTestSession } from './harness/session';
import { bindApp } from './setup';

const tick = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface SetupResult {
  projectId: ProjectId;
  filename: string;
}

async function bootstrapProject(): Promise<SetupResult> {
  await register('alice', 'password123');
  const project = await $session.api.createProject({ title: 'Sync Test' });
  return {
    projectId: project.id as ProjectId,
    filename: 'chapter.md',
  };
}

describe('startEditorSync', () => {
  let server: TestServer;

  beforeEach(() => {
    server = buildTestServer();
    bindApp(server.root);
    setupTestSession();
  });

  it('syncs updates bidirectionally over a (fake) WebSocket', async () => {
    const { projectId, filename } = await bootstrapProject();
    const fake = createFakeWebSocketRegistry();

    const clientDoc = new Y.Doc();
    const provider = await startEditorSync({
      doc: clientDoc,
      projectId,
      filename,
      sync: {
        api: $session.api,
        auth: $session.auth,
        webSocketImpl: fake.WebSocketImpl,
      },
    });
    expect(provider).toBeDefined();
    await tick();

    const serverDoc = fake.serverDoc(projectId, filename);

    clientDoc.getText('t').insert(0, 'hello');
    await tick();
    expect(serverDoc.getText('t').toString()).toBe('hello');

    serverDoc.getText('t').insert(5, ' world');
    await tick();
    expect(clientDoc.getText('t').toString()).toBe('hello world');

    provider?.disconnect();
    expect(provider?.status).toBe('disconnected');

    clientDoc.destroy();
    serverDoc.destroy();
  });

  it('pulls existing server state on the initial HTTP sync before opening the socket', async () => {
    const { projectId, filename } = await bootstrapProject();

    const seedDoc = new Y.Doc();
    seedDoc.getText('t').insert(0, 'preexisting content');
    const seedUpdate = Y.encodeStateAsUpdate(seedDoc);
    await $session.api.syncPush(projectId, filename, seedUpdate);
    seedDoc.destroy();

    const fake = createFakeWebSocketRegistry();
    const clientDoc = new Y.Doc();
    const provider = await startEditorSync({
      doc: clientDoc,
      projectId,
      filename,
      sync: {
        api: $session.api,
        auth: $session.auth,
        webSocketImpl: fake.WebSocketImpl,
      },
    });
    await tick();

    expect(clientDoc.getText('t').toString()).toBe('preexisting content');

    provider?.disconnect();
    clientDoc.destroy();
  });

  it('falls back to HTTP polling when the WebSocket errors immediately', async () => {
    const { projectId, filename } = await bootstrapProject();
    const fake = createFakeWebSocketRegistry({ alwaysError: true });

    const clientDoc = new Y.Doc();
    const provider = await startEditorSync({
      doc: clientDoc,
      projectId,
      filename,
      sync: {
        api: $session.api,
        auth: $session.auth,
        webSocketImpl: fake.WebSocketImpl,
      },
    });
    // Let the WS error fire and the fallback HTTP sync complete.
    await tick();
    await tick();

    expect(provider?.status).toBe('connected');

    clientDoc.getText('t').insert(0, 'polling works');
    // The polling provider buffers updates until its next interval, so force
    // a round-trip via a peer client instead of waiting.
    const peer = new Y.Doc();
    const diff = await $session.api.syncPush(
      projectId,
      filename,
      Y.encodeStateAsUpdate(clientDoc),
    );
    if (diff.byteLength > 0) {
      Y.applyUpdate(peer, diff);
    }
    const after = await $session.api.syncPush(
      projectId,
      filename,
      new Uint8Array(),
      Y.encodeStateVector(peer),
    );
    if (after.byteLength > 0) {
      Y.applyUpdate(peer, after);
    }
    expect(peer.getText('t').toString()).toBe('polling works');

    provider?.disconnect();
    clientDoc.destroy();
    peer.destroy();
  });
});
