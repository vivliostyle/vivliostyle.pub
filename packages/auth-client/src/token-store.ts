export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  accessTokenExpiresAt: number;
  scope?: string;
}

export interface TokenStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: StoredTokens | null = null;

  async load(): Promise<StoredTokens | null> {
    return this.tokens;
  }

  async save(tokens: StoredTokens): Promise<void> {
    this.tokens = tokens;
  }

  async clear(): Promise<void> {
    this.tokens = null;
  }
}
