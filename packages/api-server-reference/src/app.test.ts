import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createApp } from './app';
import { pkceChallengeS256, sha256Hex } from './crypto';

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

type App = ReturnType<typeof createApp>['app'];

const REDIRECT_URI = 'https://app.example/callback';
const CLIENT_ID = 'reference-client';

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function register(
  app: App,
  username = 'alice',
  password = 'password123',
) {
  return app.request('/auth/register', postJson({ username, password }));
}

async function authenticate(
  app: App,
  username = 'alice',
  password = 'password123',
) {
  const verifier = 'verifier-abcdefghijklmnopqrstuvwxyz-0123456789';
  const codeChallenge = pkceChallengeS256(verifier);
  const authorizeRes = await app.request(
    '/oauth/authorize',
    postJson({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge,
      codeChallengeMethod: 'S256',
      username,
      password,
    }),
  );
  const { code } = (await authorizeRes.json()) as { code: string };
  const tokenRes = await app.request(
    '/oauth/token',
    postJson({
      grantType: 'authorization_code',
      code,
      codeVerifier: verifier,
      redirectUri: REDIRECT_URI,
      clientId: CLIENT_ID,
    }),
  );
  return (await tokenRes.json()) as {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
  };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function createProject(app: App, token: string, title = 'Book') {
  const res = await app.request('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ title }),
  });
  return (await res.json()) as { id: string; title?: string };
}

describe('capabilities', () => {
  it('advertises features at the well-known endpoint', async () => {
    const { app } = createApp();
    const res = await app.request('/.well-known/vivliostyle-pub');
    expect(res.status).toBe(200);
    const body = await readJson<{
      features: Record<string, boolean>;
      apiVersions: string[];
    }>(res);
    expect(body.features).toEqual({
      sync: true,
      attachments: true,
      oauth: true,
    });
    expect(body.apiVersions).toContain('1.0');
  });
});

describe('openapi document', () => {
  it('serves a generated OpenAPI 3.1 document', async () => {
    const { app } = createApp();
    const res = await app.request('/openapi');
    expect(res.status).toBe(200);
    const spec = await readJson<{
      openapi: string;
      paths: Record<string, unknown>;
    }>(res);
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/projects']).toBeDefined();
  });
});

describe('auth', () => {
  let app: App;
  beforeEach(() => {
    app = createApp().app;
  });

  it('registers a user and rejects duplicates', async () => {
    const first = await register(app);
    expect(first.status).toBe(201);
    const dup = await register(app);
    expect(dup.status).toBe(409);
  });

  it('completes the PKCE authorization-code flow', async () => {
    await register(app);
    const tokens = await authenticate(app);
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();

    const me = await app.request('/oauth/userinfo', {
      headers: bearer(tokens.accessToken),
    });
    expect(me.status).toBe(200);
    expect((await readJson<{ username: string }>(me)).username).toBe('alice');
  });

  it('rejects an invalid PKCE verifier', async () => {
    await register(app);
    const codeChallenge = pkceChallengeS256('the-real-verifier');
    const authorizeRes = await app.request(
      '/oauth/authorize',
      postJson({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        codeChallenge,
        codeChallengeMethod: 'S256',
        username: 'alice',
        password: 'password123',
      }),
    );
    const { code } = (await authorizeRes.json()) as { code: string };
    const tokenRes = await app.request(
      '/oauth/token',
      postJson({
        grantType: 'authorization_code',
        code,
        codeVerifier: 'wrong-verifier',
        redirectUri: REDIRECT_URI,
        clientId: CLIENT_ID,
      }),
    );
    expect(tokenRes.status).toBe(400);
  });

  it('rejects bad credentials', async () => {
    await register(app);
    const res = await app.request(
      '/oauth/authorize',
      postJson({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        codeChallenge: pkceChallengeS256('v'),
        username: 'alice',
        password: 'wrong',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token', async () => {
    await register(app);
    const tokens = await authenticate(app);
    const refreshRes = await app.request(
      '/oauth/refresh',
      postJson({ refreshToken: tokens.refreshToken, clientId: CLIENT_ID }),
    );
    expect(refreshRes.status).toBe(200);
    const refreshed = await readJson<{ accessToken: string }>(refreshRes);
    expect(refreshed.accessToken).not.toBe(tokens.accessToken);

    // Old refresh token is single-use.
    const reuse = await app.request(
      '/oauth/refresh',
      postJson({ refreshToken: tokens.refreshToken, clientId: CLIENT_ID }),
    );
    expect(reuse.status).toBe(400);
  });

  it('requires a bearer token for projects', async () => {
    const res = await app.request('/projects');
    expect(res.status).toBe(401);
  });
});

describe('projects', () => {
  let app: App;
  let token: string;
  beforeEach(async () => {
    app = createApp().app;
    await register(app);
    token = (await authenticate(app)).accessToken;
  });

  it('creates, lists, updates and deletes projects', async () => {
    const project = await createProject(app, token, 'My Book');
    expect(project.title).toBe('My Book');

    const list = await app.request('/projects', { headers: bearer(token) });
    expect(
      (await readJson<{ projects: unknown[] }>(list)).projects,
    ).toHaveLength(1);

    const updated = await app.request(`/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...bearer(token) },
      body: JSON.stringify({ author: 'Alice' }),
    });
    expect((await readJson<{ author: string }>(updated)).author).toBe('Alice');

    const del = await app.request(`/projects/${project.id}`, {
      method: 'DELETE',
      headers: bearer(token),
    });
    expect(del.status).toBe(204);

    const after = await app.request(`/projects/${project.id}`, {
      headers: bearer(token),
    });
    expect(after.status).toBe(404);
  });

  it("does not expose another user's project", async () => {
    const project = await createProject(app, token);
    await register(app, 'bob', 'password123');
    const bobToken = (await authenticate(app, 'bob', 'password123'))
      .accessToken;
    const res = await app.request(`/projects/${project.id}`, {
      headers: bearer(bobToken),
    });
    expect(res.status).toBe(404);
  });
});

describe('files', () => {
  let app: App;
  let token: string;
  let projectId: string;
  beforeEach(async () => {
    app = createApp().app;
    await register(app);
    token = (await authenticate(app)).accessToken;
    projectId = (await createProject(app, token)).id;
  });

  it('writes, reads, lists and deletes files', async () => {
    const put = await app.request(`/projects/${projectId}/files/chapter.md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown', ...bearer(token) },
      body: '# Hello',
    });
    expect(put.status).toBe(204);

    const get = await app.request(`/projects/${projectId}/files/chapter.md`, {
      headers: bearer(token),
    });
    expect(get.status).toBe(200);
    expect(get.headers.get('Content-Type')).toBe('text/markdown');
    expect(await get.text()).toBe('# Hello');

    const list = await app.request(`/projects/${projectId}/files`, {
      headers: bearer(token),
    });
    const { files } = await readJson<{ files: { path: string }[] }>(list);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('chapter.md');

    const del = await app.request(`/projects/${projectId}/files/chapter.md`, {
      method: 'DELETE',
      headers: bearer(token),
    });
    expect(del.status).toBe(204);
  });

  it('supports nested file paths', async () => {
    await app.request(`/projects/${projectId}/files/images/cover.txt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain', ...bearer(token) },
      body: 'cover',
    });
    const get = await app.request(
      `/projects/${projectId}/files/images/cover.txt`,
      { headers: bearer(token) },
    );
    expect(await get.text()).toBe('cover');
  });
});

describe('attachments', () => {
  let app: App;
  let token: string;
  let projectId: string;
  beforeEach(async () => {
    app = createApp().app;
    await register(app);
    token = (await authenticate(app)).accessToken;
    projectId = (await createProject(app, token)).id;
  });

  it('stores and retrieves a content-addressed attachment', async () => {
    const data = new TextEncoder().encode('binary payload');
    const sha256 = sha256Hex(data);
    const put = await app.request(
      `/projects/${projectId}/attachments/${sha256}`,
      { method: 'PUT', headers: bearer(token), body: data },
    );
    expect(put.status).toBe(201);
    expect((await readJson<{ size: number }>(put)).size).toBe(data.byteLength);

    const get = await app.request(
      `/projects/${projectId}/attachments/${sha256}`,
      { headers: bearer(token) },
    );
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(data);
  });

  it('rejects a hash mismatch', async () => {
    const data = new TextEncoder().encode('payload');
    const res = await app.request(
      `/projects/${projectId}/attachments/deadbeef`,
      { method: 'PUT', headers: bearer(token), body: data },
    );
    expect(res.status).toBe(400);
  });
});

describe('sync (http)', () => {
  let app: App;
  let token: string;
  let projectId: string;
  beforeEach(async () => {
    app = createApp().app;
    await register(app);
    token = (await authenticate(app)).accessToken;
    projectId = (await createProject(app, token)).id;
  });

  it('merges a posted Yjs update and serves it back', async () => {
    const local = new Y.Doc();
    local.getText('body').insert(0, 'hello yjs');
    const update = Y.encodeStateAsUpdate(local);

    const post = await app.request(`/projects/${projectId}/sync`, {
      method: 'POST',
      headers: bearer(token),
      body: update,
    });
    expect(post.status).toBe(200);

    const remote = new Y.Doc();
    const get = await app.request(`/projects/${projectId}/sync`, {
      headers: bearer(token),
    });
    Y.applyUpdate(remote, new Uint8Array(await get.arrayBuffer()));
    expect(remote.getText('body').toString()).toBe('hello yjs');
  });

  it('returns only the diff for a provided state vector', async () => {
    const local = new Y.Doc();
    local.getText('body').insert(0, 'abc');
    await app.request(`/projects/${projectId}/sync`, {
      method: 'POST',
      headers: bearer(token),
      body: Y.encodeStateAsUpdate(local),
    });

    const sv = Buffer.from(Y.encodeStateVector(local)).toString('base64url');
    const get = await app.request(`/projects/${projectId}/sync?sv=${sv}`, {
      headers: bearer(token),
    });
    // No further changes, so the diff is the empty update.
    const diff = new Uint8Array(await get.arrayBuffer());
    const check = new Y.Doc();
    Y.applyUpdate(check, Y.encodeStateAsUpdate(local));
    Y.applyUpdate(check, diff);
    expect(check.getText('body').toString()).toBe('abc');
  });
});
