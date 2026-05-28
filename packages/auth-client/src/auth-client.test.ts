import { describe, expect, it } from 'vitest';

import { AuthClient } from './auth-client';
import { challengeS256 } from './pkce';
import { MemoryTokenStore } from './token-store';

const BASE = 'https://sync.example';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(
  handler: (url: string, method: string, body: unknown) => Response,
  tokenStore = new MemoryTokenStore(),
) {
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    return Promise.resolve(handler(url, method, body));
  }) as typeof fetch;
  return new AuthClient({
    baseUrl: BASE,
    clientId: 'client-1',
    redirectUri: 'https://app.example/cb',
    tokenStore,
    fetch: fetchImpl,
  });
}

describe('pkce', () => {
  it('derives the S256 challenge from a verifier', async () => {
    // base64url(SHA-256("abc"))
    expect(await challengeS256('abc')).toBe(
      'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
    );
  });
});

describe('AuthClient', () => {
  it('logs in via the PKCE authorization-code flow', async () => {
    let sentChallenge: string | undefined;
    let sentVerifier: string | undefined;
    const auth = client((url, _method, body) => {
      const b = body as Record<string, string>;
      if (url.endsWith('/oauth/authorize')) {
        sentChallenge = b.codeChallenge;
        return jsonResponse({ code: 'AUTH_CODE', redirectUri: b.redirectUri });
      }
      if (url.endsWith('/oauth/token')) {
        sentVerifier = b.codeVerifier;
        return jsonResponse({
          accessToken: 'access-1',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshToken: 'refresh-1',
        });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const tokens = await auth.login('alice', 'password123');
    expect(tokens.accessToken).toBe('access-1');
    expect(sentChallenge).toBe(await challengeS256(sentVerifier ?? ''));
    expect(await auth.getAccessToken()).toBe('access-1');
  });

  it('refreshes an expired access token', async () => {
    const store = new MemoryTokenStore();
    await store.save({
      accessToken: 'old-access',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: Date.now() - 1000,
    });
    let refreshCalls = 0;
    const auth = client((url) => {
      if (url.endsWith('/oauth/refresh')) {
        refreshCalls += 1;
        return jsonResponse({
          accessToken: 'new-access',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshToken: 'refresh-2',
        });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    }, store);

    expect(await auth.getAccessToken()).toBe('new-access');
    expect(refreshCalls).toBe(1);
  });

  it('clears tokens on logout', async () => {
    const store = new MemoryTokenStore();
    await store.save({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: Date.now() + 60_000,
    });
    let revoked = false;
    const auth = client((url, method) => {
      if (url.endsWith('/oauth/session') && method === 'DELETE') {
        revoked = true;
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    }, store);

    await auth.logout();
    expect(revoked).toBe(true);
    expect(await auth.getAccessToken()).toBeNull();
  });

  it('throws when registration is rejected', async () => {
    const auth = client(() => jsonResponse({ error: 'conflict' }, 409));
    await expect(auth.register('alice', 'password123')).rejects.toThrow();
  });
});
