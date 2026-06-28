import { randomToken } from './crypto';
import type { FileStore } from './storage/file-store';
import type { SqliteStore } from './storage/sqlite-store';
import type { DocRegistry } from './sync/doc-registry';

export interface ServerConfig {
  name: string;
  version: string;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
  authCodeTtlMs: number;
  sessionTtlMs: number;
  /** HMAC secret backing the signed direct-download URLs. */
  downloadUrlSecret: string;
  /** How long a signed direct-download URL stays valid. */
  downloadUrlTtlMs: number;
}

export const defaultConfig: ServerConfig = {
  name: 'vivliostyle-pub-reference-server',
  version: '0.0.0',
  accessTokenTtlMs: 60 * 60 * 1000, // 1 hour
  refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  authCodeTtlMs: 5 * 60 * 1000, // 5 minutes
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  // Regenerated per process unless overridden; signed URLs are short-lived, so
  // a fresh secret on restart only invalidates URLs already handed out.
  downloadUrlSecret: randomToken(),
  downloadUrlTtlMs: 5 * 60 * 1000, // 5 minutes
};

export interface Deps {
  store: SqliteStore;
  files: FileStore;
  docs: DocRegistry;
  config: ServerConfig;
}

export type AuthEnv = {
  Variables: { userId: string };
};
