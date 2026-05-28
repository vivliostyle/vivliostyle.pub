import type { TokenResponse } from '@v/api-client';
import { generatePkce } from './pkce';
import {
  MemoryTokenStore,
  type StoredTokens,
  type TokenStore,
} from './token-store';

export interface AuthClientOptions {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  tokenStore?: TokenStore;
  fetch?: typeof globalThis.fetch;
  /** Refresh this many ms before the access token actually expires. */
  clockSkewMs?: number;
}

export interface AuthUser {
  id: string;
  username: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// Linear-time trailing-slash trim. Avoids the `/\/+$/` regex CodeQL flags as
// polynomial when applied to library input.
function trimTrailingSlash(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return end === s.length ? s : s.slice(0, end);
}

/**
 * OAuth 2.1 + PKCE client for a single sync server.
 *
 * The reference server validates credentials directly on `/oauth/authorize`
 * (returning the code as JSON) rather than redirecting, so `login()` performs
 * the authorize + token-exchange round trip in one call. Token lifecycle
 * (storage, rotation, expiry-based refresh) is handled here; multi-server
 * management lives one layer up in the app.
 */
export class AuthClient {
  readonly baseUrl: string;
  readonly clientId: string;
  private readonly redirectUri: string;
  private readonly store: TokenStore;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly clockSkewMs: number;
  private refreshing?: Promise<StoredTokens | null>;

  constructor(options: AuthClientOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.clientId = options.clientId;
    this.redirectUri = options.redirectUri;
    this.store = options.tokenStore ?? new MemoryTokenStore();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.clockSkewMs = options.clockSkewMs ?? 30_000;
  }

  private async post<T>(
    path: string,
    body: unknown,
  ): Promise<{ status: number; data: T | undefined }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Network failure: report a non-HTTP status so callers can distinguish
      // it from a server rejection.
      return { status: 0, data: undefined };
    }
    const data = res.ok ? ((await res.json()) as T) : undefined;
    return { status: res.status, data };
  }

  private persist(tokens: TokenResponse): Promise<StoredTokens> {
    const stored: StoredTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: Date.now() + tokens.expiresIn * 1000,
      scope: tokens.scope,
    };
    return this.store.save(stored).then(() => stored);
  }

  /** Register a new user (reference-server convenience). */
  async register(username: string, password: string): Promise<void> {
    const { status } = await this.post('/auth/register', {
      username,
      password,
    });
    if (status !== 201) {
      throw new AuthError('Registration failed', status);
    }
  }

  async login(username: string, password: string): Promise<StoredTokens> {
    const pkce = await generatePkce();
    const authorize = await this.post<{ code: string }>('/oauth/authorize', {
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: pkce.method,
      username,
      password,
    });
    if (!authorize.data) {
      throw new AuthError('Authorization failed', authorize.status);
    }
    const token = await this.post<TokenResponse>('/oauth/token', {
      grantType: 'authorization_code',
      code: authorize.data.code,
      codeVerifier: pkce.verifier,
      redirectUri: this.redirectUri,
      clientId: this.clientId,
    });
    if (!token.data) {
      throw new AuthError('Token exchange failed', token.status);
    }
    return this.persist(token.data);
  }

  private async doRefresh(): Promise<StoredTokens | null> {
    const current = await this.store.load();
    if (!current?.refreshToken) {
      return null;
    }
    const token = await this.post<TokenResponse>('/oauth/refresh', {
      refreshToken: current.refreshToken,
      clientId: this.clientId,
    });
    if (token.data) {
      return this.persist(token.data);
    }
    // Only discard credentials when the server definitively rejects the
    // refresh token. Transient failures (network/5xx) keep them for a retry.
    if (token.status === 400 || token.status === 401) {
      await this.store.clear();
    }
    return null;
  }

  refresh(): Promise<StoredTokens | null> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  /** Current access token, refreshing it first if it has (nearly) expired. */
  async getAccessToken(): Promise<string | null> {
    const current = await this.store.load();
    if (!current) {
      return null;
    }
    if (Date.now() < current.accessTokenExpiresAt - this.clockSkewMs) {
      return current.accessToken;
    }
    const refreshed = await this.refresh();
    if (refreshed) {
      return refreshed.accessToken;
    }
    // Refresh failed. On a transient failure the tokens are still present, so
    // fall back to the current access token while it is genuinely valid (only
    // the skew window has elapsed, not the real expiry).
    const latest = await this.store.load();
    if (latest && Date.now() < latest.accessTokenExpiresAt) {
      return latest.accessToken;
    }
    return null;
  }

  /** Bound `() => Promise<string | null>` for use as an ApiClient token provider. */
  get accessTokenProvider(): () => Promise<string | null> {
    return () => this.getAccessToken();
  }

  async getUser(): Promise<AuthUser | null> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      return null;
    }
    const res = await this.fetchImpl(`${this.baseUrl}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as AuthUser;
  }

  async logout(): Promise<void> {
    const current = await this.store.load();
    if (current?.accessToken) {
      try {
        await this.fetchImpl(`${this.baseUrl}/oauth/session`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${current.accessToken}` },
        });
      } catch {
        // Best-effort revocation; clear local tokens regardless.
      }
    }
    await this.store.clear();
  }

  /** True when a usable access token is available (refreshing if needed). */
  async isAuthenticated(): Promise<boolean> {
    return (await this.getAccessToken()) !== null;
  }
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  return new AuthClient(options);
}
