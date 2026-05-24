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
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.clientId = options.clientId;
    this.redirectUri = options.redirectUri;
    this.store = options.tokenStore ?? new MemoryTokenStore();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.clockSkewMs = options.clockSkewMs ?? 30_000;
  }

  private async post<T>(
    path: string,
    body: unknown,
    accessToken?: string,
  ): Promise<{ status: number; data: T | undefined }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
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
    if (!token.data) {
      await this.store.clear();
      return null;
    }
    return this.persist(token.data);
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
    return refreshed?.accessToken ?? null;
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
      await this.fetchImpl(`${this.baseUrl}/oauth/session`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${current.accessToken}` },
      });
    }
    await this.store.clear();
  }

  isAuthenticated(): Promise<boolean> {
    return this.store.load().then((tokens) => tokens !== null);
  }
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  return new AuthClient(options);
}
