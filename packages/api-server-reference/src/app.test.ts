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

function postForm(body: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  };
}

async function register(
  app: App,
  username = 'alice',
  password = 'password123',
) {
  return app.request('/auth/register', postJson({ username, password }));
}

/** Sign in with a password and return the session token. */
async function signIn(
  app: App,
  username = 'alice',
  password = 'password123',
): Promise<string> {
  const res = await app.request(
    '/auth/sign-in',
    postJson({ username, password }),
  );
  return ((await res.json()) as { token: string }).token;
}

/** Run `/auth/oauth2/authorize` and return the code from the redirect URL. */
async function authorizeCode(
  app: App,
  verifier: string,
  username = 'alice',
  password = 'password123',
): Promise<string> {
  const sessionToken = await signIn(app, username, password);
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: pkceChallengeS256(verifier),
    code_challenge_method: 'S256',
  }).toString();
  const res = await app.request(`/auth/oauth2/authorize?${query}`, {
    headers: bearer(sessionToken),
  });
  const { url } = (await res.json()) as { url: string };
  return new URL(url).searchParams.get('code') as string;
}

async function authenticate(
  app: App,
  username = 'alice',
  password = 'password123',
) {
  const verifier = 'verifier-abcdefghijklmnopqrstuvwxyz-0123456789';
  const code = await authorizeCode(app, verifier, username, password);
  const tokenRes = await app.request(
    '/auth/oauth2/token',
    postForm({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
    }),
  );
  const t = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    tokenType: t.token_type,
    expiresIn: t.expires_in,
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

  it('serves an HTML reference page at /docs', async () => {
    const { app } = createApp();
    const res = await app.request('/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('id="api-reference"');
    expect(html).toContain('data-url="./openapi"');
    expect(html).toContain('@scalar/api-reference');
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

    const me = await app.request('/auth/oauth2/userinfo', {
      headers: bearer(tokens.accessToken),
    });
    expect(me.status).toBe(200);
    expect((await readJson<{ name: string }>(me)).name).toBe('alice');
  });

  it('rejects an invalid PKCE verifier', async () => {
    await register(app);
    const code = await authorizeCode(app, 'the-real-verifier');
    const tokenRes = await app.request(
      '/auth/oauth2/token',
      postForm({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier',
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      }),
    );
    expect(tokenRes.status).toBe(400);
  });

  it('rejects bad credentials at sign-in', async () => {
    await register(app);
    const res = await app.request(
      '/auth/sign-in',
      postJson({ username: 'alice', password: 'wrong' }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects authorize without a valid session', async () => {
    await register(app);
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: pkceChallengeS256('v'),
      code_challenge_method: 'S256',
    }).toString();
    const res = await app.request(`/auth/oauth2/authorize?${query}`, {
      headers: bearer('not-a-session'),
    });
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token', async () => {
    await register(app);
    const tokens = await authenticate(app);
    const refreshRes = await app.request(
      '/auth/oauth2/token',
      postForm({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: CLIENT_ID,
      }),
    );
    expect(refreshRes.status).toBe(200);
    const refreshed = await readJson<{ access_token: string }>(refreshRes);
    expect(refreshed.access_token).not.toBe(tokens.accessToken);

    // Old refresh token is single-use.
    const reuse = await app.request(
      '/auth/oauth2/token',
      postForm({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: CLIENT_ID,
      }),
    );
    expect(reuse.status).toBe(400);
  });

  it('revokes a grant via the refresh token and rejects its access token', async () => {
    await register(app);
    const tokens = await authenticate(app);
    expect(
      (await app.request('/projects', { headers: bearer(tokens.accessToken) }))
        .status,
    ).toBe(200);

    const revoked = await app.request(
      '/auth/oauth2/revoke',
      postForm({
        client_id: CLIENT_ID,
        token: tokens.refreshToken,
        token_type_hint: 'refresh_token',
      }),
    );
    expect(revoked.status).toBe(200);

    expect(
      (await app.request('/projects', { headers: bearer(tokens.accessToken) }))
        .status,
    ).toBe(401);

    const reuse = await app.request(
      '/auth/oauth2/token',
      postForm({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: CLIENT_ID,
      }),
    );
    expect(reuse.status).toBe(400);
  });

  it('revokes a grant via its access token', async () => {
    await register(app);
    const tokens = await authenticate(app);
    const revoked = await app.request(
      '/auth/oauth2/revoke',
      postForm({
        client_id: CLIENT_ID,
        token: tokens.accessToken,
        token_type_hint: 'access_token',
      }),
    );
    expect(revoked.status).toBe(200);
    expect(
      (await app.request('/projects', { headers: bearer(tokens.accessToken) }))
        .status,
    ).toBe(401);
  });

  it('does not revoke a token presented by another client', async () => {
    await register(app);
    const tokens = await authenticate(app);
    const res = await app.request(
      '/auth/oauth2/revoke',
      postForm({
        client_id: 'someone-else',
        token: tokens.accessToken,
        token_type_hint: 'access_token',
      }),
    );
    expect(res.status).toBe(200);
    // The access token still works: a client cannot revoke another's grant.
    expect(
      (await app.request('/projects', { headers: bearer(tokens.accessToken) }))
        .status,
    ).toBe(200);
  });

  it('responds 200 when revoking an unknown token', async () => {
    const res = await app.request(
      '/auth/oauth2/revoke',
      postForm({ client_id: CLIENT_ID, token: 'no-such-token' }),
    );
    expect(res.status).toBe(200);
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

    const post = await app.request(`/projects/${projectId}/sync/chapter.md`, {
      method: 'POST',
      headers: bearer(token),
      body: update,
    });
    expect(post.status).toBe(200);

    const remote = new Y.Doc();
    const get = await app.request(`/projects/${projectId}/sync/chapter.md`, {
      headers: bearer(token),
    });
    Y.applyUpdate(remote, new Uint8Array(await get.arrayBuffer()));
    expect(remote.getText('body').toString()).toBe('hello yjs');
  });

  it('returns only the diff for a provided state vector', async () => {
    const local = new Y.Doc();
    local.getText('body').insert(0, 'abc');
    await app.request(`/projects/${projectId}/sync/chapter.md`, {
      method: 'POST',
      headers: bearer(token),
      body: Y.encodeStateAsUpdate(local),
    });

    const sv = Buffer.from(Y.encodeStateVector(local)).toString('base64url');
    const get = await app.request(
      `/projects/${projectId}/sync/chapter.md?sv=${sv}`,
      { headers: bearer(token) },
    );
    // No further changes, so the diff is the empty update.
    const diff = new Uint8Array(await get.arrayBuffer());
    const check = new Y.Doc();
    Y.applyUpdate(check, Y.encodeStateAsUpdate(local));
    Y.applyUpdate(check, diff);
    expect(check.getText('body').toString()).toBe('abc');
  });

  it('accepts a pull-only POST with empty body and a non-trivial sv', async () => {
    // Mirrors the client's startEditorSync initial sync: empty body, state
    // vector reflecting the client's IndexedDB-hydrated Y.Doc.
    const local = new Y.Doc();
    local.getText('body').insert(0, 'hi');
    const sv = Buffer.from(Y.encodeStateVector(local)).toString('base64url');
    const res = await app.request(
      `/projects/${projectId}/sync/drafts/manuscript.md?sv=${sv}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...bearer(token),
        },
        body: new Uint8Array(),
      },
    );
    expect(res.status).toBe(200);
  });

  it('rejects malformed update bytes with invalid_update', async () => {
    // A Yjs state vector is *not* a valid update body; sending one as the
    // POST body should produce invalid_update (not invalid_state_vector).
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'x');
    const res = await app.request(`/projects/${projectId}/sync/chapter.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...bearer(token) },
      body: Y.encodeStateVector(doc),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_update' });
  });

  it('rejects a truncated state vector with invalid_state_vector', async () => {
    // sv=AQ decodes to [0x01] — claims length=1 but no client/clock follows.
    const res = await app.request(
      `/projects/${projectId}/sync/chapter.md?sv=AQ`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...bearer(token),
        },
        body: new Uint8Array(),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_state_vector' });
  });

  it('keeps per-file sync state isolated', async () => {
    const ch1 = new Y.Doc();
    ch1.getText('body').insert(0, 'one');
    await app.request(`/projects/${projectId}/sync/chapter1.md`, {
      method: 'POST',
      headers: bearer(token),
      body: Y.encodeStateAsUpdate(ch1),
    });

    const ch2 = new Y.Doc();
    ch2.getText('body').insert(0, 'two');
    await app.request(`/projects/${projectId}/sync/chapter2.md`, {
      method: 'POST',
      headers: bearer(token),
      body: Y.encodeStateAsUpdate(ch2),
    });

    const get1 = await app.request(`/projects/${projectId}/sync/chapter1.md`, {
      headers: bearer(token),
    });
    const get2 = await app.request(`/projects/${projectId}/sync/chapter2.md`, {
      headers: bearer(token),
    });
    const remote1 = new Y.Doc();
    const remote2 = new Y.Doc();
    Y.applyUpdate(remote1, new Uint8Array(await get1.arrayBuffer()));
    Y.applyUpdate(remote2, new Uint8Array(await get2.arrayBuffer()));
    expect(remote1.getText('body').toString()).toBe('one');
    expect(remote2.getText('body').toString()).toBe('two');
  });
});
