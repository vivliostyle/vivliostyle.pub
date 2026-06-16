import { describe, expect, it } from 'vitest';

import { AuthClient } from './auth-client';
import { challengeS256 } from './pkce';
import { MemoryTokenStore } from './token-store';

const BASE = 'https://api.example';
const REDIRECT = 'https://app.example/cb';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Handler = (url: URL, method: string, init?: RequestInit) => Response;

function client(handler: Handler, tokenStore = new MemoryTokenStore()) {
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    return Promise.resolve(handler(url, init?.method ?? 'GET', init));
  }) as typeof fetch;
  return new AuthClient({
    baseUrl: BASE,
    clientId: 'web',
    redirectUri: REDIRECT,
    tokenStore,
    fetch: fetchImpl,
  });
}

function jsonBody(init?: RequestInit): Record<string, string> {
  return init?.body ? JSON.parse(init.body as string) : {};
}

function form(init?: RequestInit): URLSearchParams {
  return new URLSearchParams((init?.body as string) ?? '');
}

describe('pkce', () => {
  it('derives the S256 challenge from a verifier', async () => {
    // base64url(SHA-256("abc"))
    expect(await challengeS256('abc')).toBe(
      'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
    );
  });
});

describe('AuthClient (OIDC)', () => {
  it('logs in via sign-in then the authorization-code + PKCE flow (password)', async () => {
    let signInBody: Record<string, string> = {};
    let authorizeBearer: string | undefined;
    let sentChallenge: string | null = null;
    let sentVerifier: string | undefined;
    const auth = client((url, _method, init) => {
      if (url.pathname === '/auth/sign-in') {
        signInBody = jsonBody(init);
        return jsonResponse({
          token: 'session-1',
          user: { id: 'u1', username: 'alice' },
        });
      }
      if (url.pathname === '/auth/oauth2/authorize') {
        authorizeBearer = (init?.headers as Record<string, string>)
          .Authorization;
        sentChallenge = url.searchParams.get('code_challenge');
        return jsonResponse({
          redirect: true,
          url: `${REDIRECT}?code=AUTH_CODE&state=x`,
        });
      }
      if (url.pathname === '/auth/oauth2/token') {
        sentVerifier = form(init).get('code_verifier') ?? undefined;
        return jsonResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const tokens = await auth.login('alice', 'password123');
    expect(signInBody).toEqual({ username: 'alice', password: 'password123' });
    expect(authorizeBearer).toBe('Bearer session-1');
    expect(tokens.accessToken).toBe('access-1');
    expect(sentChallenge).toBe(await challengeS256(sentVerifier ?? ''));
    expect(await auth.getAccessToken()).toBe('access-1');
  });

  it('exchanges a session bearer for tokens (email-OTP path)', async () => {
    let bearer: string | undefined;
    const auth = client((url, _method, init) => {
      if (url.pathname === '/auth/oauth2/authorize') {
        bearer = (init?.headers as Record<string, string>).Authorization;
        return jsonResponse({ redirect: true, url: `${REDIRECT}?code=CODE2` });
      }
      if (url.pathname === '/auth/oauth2/token') {
        expect(form(init).get('code')).toBe('CODE2');
        return jsonResponse({
          access_token: 'access-2',
          refresh_token: 'r',
          expires_in: 3600,
        });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const tokens = await auth.exchangeSession('session-token');
    expect(bearer).toBe('Bearer session-token');
    expect(tokens.accessToken).toBe('access-2');
  });

  it('reads the code from a 302 Location when not answered as JSON', async () => {
    const auth = client((url) => {
      if (url.pathname === '/auth/oauth2/authorize') {
        return new Response(null, {
          status: 302,
          headers: { location: `${REDIRECT}?code=CODE_302` },
        });
      }
      if (url.pathname === '/auth/oauth2/token') {
        return jsonResponse({ access_token: 'a', expires_in: 3600 });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });
    expect((await auth.exchangeSession('s')).accessToken).toBe('a');
  });

  it('refreshes an expired access token', async () => {
    const store = new MemoryTokenStore();
    await store.save({
      accessToken: 'old',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: Date.now() - 1000,
    });
    const auth = client((url, _method, init) => {
      if (url.pathname === '/auth/oauth2/token') {
        expect(form(init).get('grant_type')).toBe('refresh_token');
        return jsonResponse({
          access_token: 'fresh',
          refresh_token: 'refresh-2',
          expires_in: 3600,
        });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    }, store);
    expect(await auth.getAccessToken()).toBe('fresh');
  });

  it('loads the user from /oauth2/userinfo claims', async () => {
    const store = new MemoryTokenStore();
    await store.save({
      accessToken: 'access-1',
      refreshToken: 'r',
      accessTokenExpiresAt: Date.now() + 60_000,
    });
    const auth = client((url) => {
      if (url.pathname === '/auth/oauth2/userinfo') {
        return jsonResponse({ sub: 'user-1', email: 'a@example.com' });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    }, store);
    expect(await auth.getUser()).toEqual({
      id: 'user-1',
      username: 'a@example.com',
    });
  });

  it('revokes the refresh token on logout, then clears the store', async () => {
    const store = new MemoryTokenStore();
    await store.save({
      accessToken: 'a',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: Date.now() + 60_000,
    });
    let revoked: URLSearchParams | undefined;
    const auth = client((url, _method, init) => {
      if (url.pathname === '/auth/oauth2/revoke') {
        revoked = form(init);
        return new Response(null, { status: 200 });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    }, store);

    await auth.logout();
    expect(revoked?.get('client_id')).toBe('web');
    expect(revoked?.get('token')).toBe('refresh-1');
    expect(revoked?.get('token_type_hint')).toBe('refresh_token');
    expect(await store.load()).toBeNull();
  });

  it('clears the store even when revocation fails', async () => {
    const store = new MemoryTokenStore();
    await store.save({
      accessToken: 'a',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: Date.now() + 60_000,
    });
    const auth = client(() => {
      throw new Error('network down');
    }, store);

    await auth.logout();
    expect(await store.load()).toBeNull();
  });
});
