import type { SqliteStore } from './store';
import type { DocRegistry } from './sync-doc';

export interface ServerConfig {
  name: string;
  version: string;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
  authCodeTtlMs: number;
}

export const defaultConfig: ServerConfig = {
  name: 'vivliostyle-pub-reference-server',
  version: '0.0.0',
  accessTokenTtlMs: 60 * 60 * 1000, // 1 hour
  refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  authCodeTtlMs: 5 * 60 * 1000, // 5 minutes
};

export interface Deps {
  store: SqliteStore;
  docs: DocRegistry;
  config: ServerConfig;
}

export type AuthEnv = {
  Variables: { userId: string };
};
