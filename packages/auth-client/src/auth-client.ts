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

// Matches the server's registered client: `openid` gates the userinfo endpoint
// (where the client reads the user), `profile`/`email` populate its claims, and
// `offline_access` yields a refresh token.
const SCOPE = 'openid profile email offline_access';

// Linear-time trailing-slash trim. Avoids the `/\/+$/` regex CodeQL flags as
// polynomial when applied to library input.
function trimTrailingSlash(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return end === s.length ? s : s.slice(0, end);
}

interface OidcTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

// A browser fetch to `/auth/oauth2/authorize` receives `{ redirect, url }` JSON (the
// provider detects the fetch and declines to 302); a raw request would instead
// get a 302 whose `Location` carries the same URL. Read the code from either.
async function readAuthorizationCode(res: Response): Promise<string | null> {
  const location = res.headers.get('location');
  const fromUrl = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    try {
      return new URL(raw).searchParams.get('code');
    } catch {
      return null;
    }
  };
  if (location) return fromUrl(location);
  try {
    const data = (await res.json()) as { url?: string; code?: string };
    return data.code ?? fromUrl(data.url);
  } catch {
    return null;
  }
}

/**
 * OAuth 2.1 + PKCE client for a single OpenID Connect provider (`/auth/oauth2/*`,
 * e.g. Better Auth's `oidcProvider`).
 *
 * Authentication and token issuance are separate: the user signs in out of band
 * — by password ({@link AuthClient.login}) or by an extension's own flow such as
 * email-OTP, which hands over a session bearer ({@link
 * AuthClient.exchangeSession}) — and this client runs the authorization-code +
 * PKCE round trip to obtain the access/refresh tokens. Token lifecycle
 * (storage, expiry-based refresh) is handled here; multi-server management lives
 * one layer up in the app.
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

  private persist(res: OidcTokenResponse): Promise<StoredTokens> {
    const stored: StoredTokens = {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? '',
      accessTokenExpiresAt: Date.now() + res.expires_in * 1000,
      scope: res.scope,
    };
    return this.store.save(stored).then(() => stored);
  }

  private authorizeQuery(challenge: string): string {
    return new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
  }

  private async exchangeCode(
    code: string,
    verifier: string,
  ): Promise<StoredTokens> {
    const token = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: verifier,
    });
    if (!token) {
      throw new AuthError('Token exchange failed', 0);
    }
    return this.persist(token);
  }

  private async token(
    params: Record<string, string>,
  ): Promise<OidcTokenResponse | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
    } catch {
      return null;
    }
    return res.ok ? ((await res.json()) as OidcTokenResponse) : null;
  }

  /** Register a new user (reference-server convenience). */
  async register(username: string, password: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.status !== 201) {
      throw new AuthError('Registration failed', res.status);
    }
  }

  async login(username: string, password: string): Promise<StoredTokens> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/auth/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      throw new AuthError('Sign-in request failed', 0);
    }
    if (!res.ok) {
      throw new AuthError('Sign-in failed', res.status);
    }
    const { token } = (await res.json()) as { token?: string };
    if (!token) {
      throw new AuthError('Sign-in returned no session token', res.status);
    }
    return this.exchangeSession(token);
  }

  async exchangeSession(sessionToken: string): Promise<StoredTokens> {
    const pkce = await generatePkce();
    let authorize: Response;
    try {
      authorize = await this.fetchImpl(
        `${this.baseUrl}/auth/oauth2/authorize?${this.authorizeQuery(pkce.challenge)}`,
        { headers: { Authorization: `Bearer ${sessionToken}` } },
      );
    } catch {
      throw new AuthError('Authorization request failed', 0);
    }
    if (authorize.status >= 400) {
      throw new AuthError('Authorization failed', authorize.status);
    }
    const code = await readAuthorizationCode(authorize);
    if (!code) {
      throw new AuthError('Authorization returned no code', authorize.status);
    }
    return this.exchangeCode(code, pkce.verifier);
  }

  private async doRefresh(): Promise<StoredTokens | null> {
    const current = await this.store.load();
    if (!current?.refreshToken) {
      return null;
    }
    const token = await this.token({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: this.clientId,
    });
    if (token) {
      return this.persist(token);
    }
    await this.store.clear();
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
    const res = await this.fetchImpl(`${this.baseUrl}/auth/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return null;
    }
    const claims = (await res.json()) as {
      sub?: string;
      email?: string;
      name?: string;
    };
    if (!claims.sub) {
      return null;
    }
    return {
      id: claims.sub,
      username: claims.email ?? claims.name ?? claims.sub,
    };
  }

  async logout(): Promise<void> {
    const current = await this.store.load();
    const token = current?.refreshToken || current?.accessToken;
    if (token) {
      try {
        await this.fetchImpl(`${this.baseUrl}/auth/oauth2/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.clientId,
            token,
            token_type_hint: current?.refreshToken
              ? 'refresh_token'
              : 'access_token',
          }).toString(),
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
