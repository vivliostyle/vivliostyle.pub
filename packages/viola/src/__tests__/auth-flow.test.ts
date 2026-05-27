import { beforeEach, describe, expect, it, vi } from 'vitest';

// `discoverProjects` enumerates OPFS, which throws under Node.
vi.mock('../stores/actions/discover-projects', () => ({
  discoverProjects: vi.fn().mockResolvedValue(undefined),
}));

import { $session } from '../stores/accessors';
import {
  login,
  logout,
  register,
  restoreSession,
} from '../stores/actions/session';
import { buildTestServer, type TestServer } from './harness/server';
import { setupTestSession } from './harness/session';
import { bindApp } from './setup';

describe('auth flow', () => {
  let server: TestServer;

  beforeEach(() => {
    server = buildTestServer();
    bindApp(server.root);
    setupTestSession();
  });

  it('cycles status through register → login → logout', async () => {
    expect($session.status).toBe('initial');

    await register('alice', 'password123');
    expect($session.status).toBe('authenticated');
    expect($session.user).toMatchObject({ username: 'alice' });

    await logout();
    expect($session.status).toBe('anonymous');
    expect($session.user).toBeNull();

    await login('alice', 'password123');
    expect($session.status).toBe('authenticated');
    expect($session.user).toMatchObject({ username: 'alice' });
  });

  it('translates a 401 from /oauth/authorize into a friendly SessionError', async () => {
    await register('alice', 'password123');
    await logout();

    await expect(login('alice', 'wrong-password')).rejects.toMatchObject({
      name: 'SessionError',
      message: 'Incorrect username or password.',
      status: 401,
    });
    expect($session.status).toBe('anonymous');
  });

  it('restores a session from persisted tokens on a fresh client', async () => {
    const first = setupTestSession();
    await register('alice', 'password123');
    expect(await first.tokenStore.load()).not.toBeNull();

    setupTestSession({ tokenStore: first.tokenStore });
    expect($session.status).toBe('initial');
    await restoreSession();
    expect($session.status).toBe('authenticated');
    expect($session.user).toMatchObject({ username: 'alice' });
  });

  it('treats a duplicate register as a 409 SessionError', async () => {
    await register('alice', 'password123');
    await logout();

    await expect(register('alice', 'password123')).rejects.toMatchObject({
      name: 'SessionError',
      message: 'That username is already taken.',
      status: 409,
    });
    expect($session.status).toBe('anonymous');
  });
});
