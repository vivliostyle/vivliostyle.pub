import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { generateId } from './crypto';
import type { ProjectInput, ProjectRecord } from './schemas';

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
}

export interface AuthCode {
  code: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string;
  expiresAt: number;
}

export interface RefreshToken {
  token: string;
  userId: string;
  clientId: string;
  scope?: string;
  expiresAt: number;
}

export interface AccessToken {
  token: string;
  userId: string;
  scope?: string;
  expiresAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT,
  author TEXT,
  language TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON projects(owner_id);
CREATE TABLE IF NOT EXISTS docs (
  project_id TEXT PRIMARY KEY,
  state BLOB NOT NULL
);
`;

type Nullable<T> = T | null;

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}

interface AuthCodeRow {
  code: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: Nullable<string>;
  expires_at: number;
}

interface RefreshTokenRow {
  token: string;
  user_id: string;
  client_id: string;
  scope: Nullable<string>;
  expires_at: number;
}

interface AccessTokenRow {
  token: string;
  user_id: string;
  scope: Nullable<string>;
  expires_at: number;
}

interface ProjectRow {
  id: string;
  owner_id: string;
  title: Nullable<string>;
  author: Nullable<string>;
  language: Nullable<string>;
  created_at: number;
  updated_at: number;
}

function toUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
  };
}

function toAuthCode(row: AuthCodeRow): AuthCode {
  return {
    code: row.code,
    userId: row.user_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    scope: row.scope ?? undefined,
    expiresAt: row.expires_at,
  };
}

function toRefreshToken(row: RefreshTokenRow): RefreshToken {
  return {
    token: row.token,
    userId: row.user_id,
    clientId: row.client_id,
    scope: row.scope ?? undefined,
    expiresAt: row.expires_at,
  };
}

function toAccessToken(row: AccessTokenRow): AccessToken {
  return {
    token: row.token,
    userId: row.user_id,
    scope: row.scope ?? undefined,
    expiresAt: row.expires_at,
  };
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    title: row.title ?? undefined,
    author: row.author ?? undefined,
    language: row.language ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SqliteStoreOptions {
  /**
   * SQLite database location. Defaults to `:memory:` (ephemeral). Pass a file
   * path for persistence across restarts.
   */
  path?: string;
}

/**
 * Persistence layer for the reference server, backed by Node's built-in
 * `node:sqlite` module. No native addon or external dependency required.
 */
export class SqliteStore {
  private db: DatabaseSync;

  constructor(options: SqliteStoreOptions = {}) {
    const path = options.path?.trim() || ':memory:';
    if (path !== ':memory:') {
      // SQLite raises `SQLITE_CANTOPEN` if the parent directory is missing;
      // create it eagerly so a freshly-cloned env can use any path the user
      // configures without a separate setup step.
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createUser(username: string, passwordHash: string): StoredUser {
    const user: StoredUser = { id: generateId(), username, passwordHash };
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
      )
      .run(user.id, user.username, user.passwordHash);
    return user;
  }

  findUserByUsername(username: string): StoredUser | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  findUserById(id: string): StoredUser | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | UserRow
      | undefined;
    return row ? toUser(row) : undefined;
  }

  saveAuthCode(code: AuthCode): void {
    this.db
      .prepare(
        `INSERT INTO auth_codes
           (code, user_id, client_id, redirect_uri, code_challenge, scope, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code.code,
        code.userId,
        code.clientId,
        code.redirectUri,
        code.codeChallenge,
        code.scope ?? null,
        code.expiresAt,
      );
  }

  takeAuthCode(code: string): AuthCode | undefined {
    const row = this.db
      .prepare('SELECT * FROM auth_codes WHERE code = ?')
      .get(code) as AuthCodeRow | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM auth_codes WHERE code = ?').run(code);
    return toAuthCode(row);
  }

  saveRefreshToken(token: RefreshToken): void {
    this.db
      .prepare(
        `INSERT INTO refresh_tokens
           (token, user_id, client_id, scope, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        token.token,
        token.userId,
        token.clientId,
        token.scope ?? null,
        token.expiresAt,
      );
  }

  takeRefreshToken(token: string): RefreshToken | undefined {
    const row = this.db
      .prepare('SELECT * FROM refresh_tokens WHERE token = ?')
      .get(token) as RefreshTokenRow | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(token);
    return toRefreshToken(row);
  }

  revokeUserTokens(userId: string): void {
    this.db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM access_tokens WHERE user_id = ?').run(userId);
  }

  saveAccessToken(token: AccessToken): void {
    this.db
      .prepare(
        `INSERT INTO access_tokens (token, user_id, scope, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(token.token, token.userId, token.scope ?? null, token.expiresAt);
  }

  findAccessToken(token: string): AccessToken | undefined {
    const row = this.db
      .prepare('SELECT * FROM access_tokens WHERE token = ?')
      .get(token) as AccessTokenRow | undefined;
    if (!row) return undefined;
    if (row.expires_at < Date.now()) {
      this.db.prepare('DELETE FROM access_tokens WHERE token = ?').run(token);
      return undefined;
    }
    return toAccessToken(row);
  }

  listProjects(ownerId: string): ProjectRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC',
      )
      .all(ownerId) as unknown as ProjectRow[];
    return rows.map(toProject);
  }

  createProject(ownerId: string, input: ProjectInput): ProjectRecord {
    const now = Date.now();
    const record: ProjectRecord = {
      id: generateId(),
      title: input.title,
      author: input.author,
      language: input.language,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO projects
           (id, owner_id, title, author, language, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        ownerId,
        record.title ?? null,
        record.author ?? null,
        record.language ?? null,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  getProject(ownerId: string, id: string): ProjectRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
      .get(id, ownerId) as ProjectRow | undefined;
    return row ? toProject(row) : undefined;
  }

  updateProject(
    ownerId: string,
    id: string,
    patch: ProjectInput,
  ): ProjectRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
      .get(id, ownerId) as ProjectRow | undefined;
    if (!row) return undefined;

    const next = {
      title: patch.title !== undefined ? patch.title : row.title,
      author: patch.author !== undefined ? patch.author : row.author,
      language: patch.language !== undefined ? patch.language : row.language,
      updated_at: Date.now(),
    };
    this.db
      .prepare(
        `UPDATE projects
           SET title = ?, author = ?, language = ?, updated_at = ?
           WHERE id = ?`,
      )
      .run(
        next.title ?? null,
        next.author ?? null,
        next.language ?? null,
        next.updated_at,
        id,
      );
    return toProject({ ...row, ...next });
  }

  removeProject(ownerId: string, id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?')
      .run(id, ownerId);
    if (result.changes === 0) return false;
    // No FK cascade on `docs` (schema kept flat for portability). Files /
    // attachments live on the filesystem, cascaded by `projectRoutes` via
    // `FileStore.removeProject`.
    this.db.prepare('DELETE FROM docs WHERE project_id = ?').run(id);
    return true;
  }

  loadDocState(projectId: string): Uint8Array | undefined {
    const row = this.db
      .prepare('SELECT state FROM docs WHERE project_id = ?')
      .get(projectId) as { state: Uint8Array } | undefined;
    return row?.state;
  }

  saveDocState(projectId: string, state: Uint8Array): void {
    this.db
      .prepare(
        `INSERT INTO docs (project_id, state) VALUES (?, ?)
         ON CONFLICT(project_id) DO UPDATE SET state = excluded.state`,
      )
      .run(projectId, state);
  }
}
