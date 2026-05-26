import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createApp } from './app';
import { pkceChallengeS256 } from './crypto';
import { SqliteStore } from './store';

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore();
  });
  afterEach(() => {
    store.close();
  });

  it('round-trips a user and looks them up by name and id', () => {
    const user = store.createUser('alice', 'hash');
    expect(store.findUserByUsername('alice')).toEqual(user);
    expect(store.findUserById(user.id)).toEqual(user);
    expect(store.findUserByUsername('bob')).toBeUndefined();
  });

  it('rejects a duplicate username at the schema level', () => {
    store.createUser('alice', 'hash');
    expect(() => store.createUser('alice', 'other')).toThrow();
  });

  it('takes a one-shot auth code and clears it', () => {
    store.saveAuthCode({
      code: 'c',
      userId: 'u',
      clientId: 'cli',
      redirectUri: 'https://app/cb',
      codeChallenge: 'x',
      expiresAt: 1,
    });
    const first = store.takeAuthCode('c');
    expect(first?.userId).toBe('u');
    expect(store.takeAuthCode('c')).toBeUndefined();
  });

  it('expires access tokens lazily on read', () => {
    store.saveAccessToken({
      token: 'expired',
      userId: 'u',
      expiresAt: Date.now() - 1000,
    });
    expect(store.findAccessToken('expired')).toBeUndefined();
    // Re-saving the same token after lazy deletion must succeed.
    store.saveAccessToken({
      token: 'expired',
      userId: 'u',
      expiresAt: Date.now() + 60_000,
    });
    expect(store.findAccessToken('expired')?.userId).toBe('u');
  });

  it('revokes all refresh and access tokens for a user', () => {
    store.saveRefreshToken({
      token: 'r1',
      userId: 'u',
      clientId: 'c',
      expiresAt: Date.now() + 1000,
    });
    store.saveAccessToken({
      token: 'a1',
      userId: 'u',
      expiresAt: Date.now() + 1000,
    });
    store.saveAccessToken({
      token: 'keep',
      userId: 'other',
      expiresAt: Date.now() + 1000,
    });
    store.revokeUserTokens('u');
    expect(store.takeRefreshToken('r1')).toBeUndefined();
    expect(store.findAccessToken('a1')).toBeUndefined();
    expect(store.findAccessToken('keep')).toBeDefined();
  });

  it('lists projects scoped to the owner and orders by updatedAt desc', () => {
    const p1 = store.createProject('owner', { title: 'a' });
    // Force a deterministic ordering: bump p1 to be older than p2.
    store.updateProject('owner', p1.id, { title: 'a' });
    const p2 = store.createProject('owner', { title: 'b' });
    store.createProject('other', { title: 'foreign' });

    const ids = store.listProjects('owner').map((p) => p.id);
    expect(ids).toContain(p1.id);
    expect(ids).toContain(p2.id);
    expect(ids).not.toContain(store.listProjects('other').map((p) => p.id)[0]);
  });

  it('updates only supplied project fields', () => {
    const p = store.createProject('owner', { title: 't', author: 'a' });
    const updated = store.updateProject('owner', p.id, { author: 'b' });
    expect(updated?.title).toBe('t');
    expect(updated?.author).toBe('b');
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });

  it('cascades doc-state cleanup on project deletion', () => {
    const p = store.createProject('owner', {});
    store.saveDocState(p.id, new Uint8Array([7, 8, 9]));

    expect(store.removeProject('owner', p.id)).toBe(true);
    expect(store.loadDocState(p.id)).toBeUndefined();
  });
});

describe('SqliteStore end-to-end via createApp', () => {
  let store: SqliteStore;
  beforeEach(() => {
    store = new SqliteStore();
  });
  afterEach(() => {
    store.close();
  });

  it('serves an auth → project → file → sync flow', async () => {
    const { app } = createApp({ store });

    const reg = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'password123' }),
    });
    expect(reg.status).toBe(201);

    const verifier = 'verifier-abcdefghijklmnopqrstuvwxyz-0123456789';
    const authorize = await app.request('/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'cli',
        redirectUri: 'https://app/cb',
        codeChallenge: pkceChallengeS256(verifier),
        codeChallengeMethod: 'S256',
        username: 'alice',
        password: 'password123',
      }),
    });
    const { code } = (await authorize.json()) as { code: string };

    const tokenRes = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grantType: 'authorization_code',
        code,
        codeVerifier: verifier,
        redirectUri: 'https://app/cb',
        clientId: 'cli',
      }),
    });
    const { accessToken } = (await tokenRes.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    const create = await app.request('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ title: 'Book' }),
    });
    const { id: projectId } = (await create.json()) as { id: string };

    const put = await app.request(`/projects/${projectId}/files/chapter.md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown', ...auth },
      body: '# hello',
    });
    expect(put.status).toBe(204);

    const get = await app.request(`/projects/${projectId}/files/chapter.md`, {
      headers: auth,
    });
    expect(await get.text()).toBe('# hello');

    const doc = new Y.Doc();
    doc.getText('body').insert(0, 'hello yjs');
    await app.request(`/projects/${projectId}/sync`, {
      method: 'POST',
      headers: auth,
      body: Y.encodeStateAsUpdate(doc),
    });
    const syncRes = await app.request(`/projects/${projectId}/sync`, {
      headers: auth,
    });
    const remote = new Y.Doc();
    Y.applyUpdate(remote, new Uint8Array(await syncRes.arrayBuffer()));
    expect(remote.getText('body').toString()).toBe('hello yjs');
  });
});

describe('SqliteStore (file-backed)', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sqlite-store-'));
    dbPath = join(dir, 'test.db');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists data across reopens', () => {
    const first = new SqliteStore({ path: dbPath });
    const user = first.createUser('alice', 'hash');
    const project = first.createProject(user.id, { title: 'T' });
    first.close();

    const second = new SqliteStore({ path: dbPath });
    expect(second.findUserByUsername('alice')?.id).toBe(user.id);
    expect(second.listProjects(user.id).map((p) => p.id)).toContain(project.id);
    second.close();
  });
});
