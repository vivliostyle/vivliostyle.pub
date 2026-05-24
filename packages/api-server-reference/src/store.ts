import { generateId } from './crypto';
import type { FileEntry, ProjectInput, ProjectRecord } from './schemas';

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

export interface StoredFile {
  path: string;
  data: Uint8Array;
  contentType: string;
  updatedAt: number;
}

/**
 * Persistence boundary for the reference server. The in-memory implementation
 * below is the default; a production deployment can supply a SQLite-backed
 * implementation (e.g. Node's `node:sqlite`) without touching the routes.
 */
export interface Store {
  createUser(username: string, passwordHash: string): StoredUser;
  findUserByUsername(username: string): StoredUser | undefined;
  findUserById(id: string): StoredUser | undefined;

  saveAuthCode(code: AuthCode): void;
  takeAuthCode(code: string): AuthCode | undefined;

  saveRefreshToken(token: RefreshToken): void;
  takeRefreshToken(token: string): RefreshToken | undefined;
  revokeUserTokens(userId: string): void;

  saveAccessToken(token: AccessToken): void;
  findAccessToken(token: string): AccessToken | undefined;

  listProjects(ownerId: string): ProjectRecord[];
  createProject(ownerId: string, input: ProjectInput): ProjectRecord;
  getProject(ownerId: string, id: string): ProjectRecord | undefined;
  updateProject(
    ownerId: string,
    id: string,
    patch: ProjectInput,
  ): ProjectRecord | undefined;
  removeProject(ownerId: string, id: string): boolean;

  listFiles(projectId: string): FileEntry[];
  readFile(projectId: string, path: string): StoredFile | undefined;
  writeFile(
    projectId: string,
    path: string,
    data: Uint8Array,
    contentType: string,
  ): FileEntry;
  removeFile(projectId: string, path: string): boolean;

  readAttachment(projectId: string, sha256: string): Uint8Array | undefined;
  writeAttachment(projectId: string, sha256: string, data: Uint8Array): void;

  loadDocState(projectId: string): Uint8Array | undefined;
  saveDocState(projectId: string, state: Uint8Array): void;
}

interface ProjectRow extends ProjectRecord {
  ownerId: string;
}

function toPublicProject(row: ProjectRow): ProjectRecord {
  const { ownerId: _ownerId, ...rest } = row;
  return rest;
}

function toFileEntry(file: StoredFile): FileEntry {
  return {
    path: file.path,
    size: file.data.byteLength,
    contentType: file.contentType,
    updatedAt: file.updatedAt,
  };
}

export class InMemoryStore implements Store {
  private users = new Map<string, StoredUser>();
  private usernameIndex = new Map<string, string>();
  private authCodes = new Map<string, AuthCode>();
  private refreshTokens = new Map<string, RefreshToken>();
  private accessTokens = new Map<string, AccessToken>();
  private projects = new Map<string, ProjectRow>();
  private files = new Map<string, Map<string, StoredFile>>();
  private attachments = new Map<string, Map<string, Uint8Array>>();
  private docs = new Map<string, Uint8Array>();

  createUser(username: string, passwordHash: string): StoredUser {
    const user: StoredUser = { id: generateId(), username, passwordHash };
    this.users.set(user.id, user);
    this.usernameIndex.set(username, user.id);
    return user;
  }

  findUserByUsername(username: string): StoredUser | undefined {
    const id = this.usernameIndex.get(username);
    return id ? this.users.get(id) : undefined;
  }

  findUserById(id: string): StoredUser | undefined {
    return this.users.get(id);
  }

  saveAuthCode(code: AuthCode): void {
    this.authCodes.set(code.code, code);
  }

  takeAuthCode(code: string): AuthCode | undefined {
    const found = this.authCodes.get(code);
    if (found) {
      this.authCodes.delete(code);
    }
    return found;
  }

  saveRefreshToken(token: RefreshToken): void {
    this.refreshTokens.set(token.token, token);
  }

  takeRefreshToken(token: string): RefreshToken | undefined {
    const found = this.refreshTokens.get(token);
    if (found) {
      this.refreshTokens.delete(token);
    }
    return found;
  }

  revokeUserTokens(userId: string): void {
    for (const [token, rt] of this.refreshTokens) {
      if (rt.userId === userId) {
        this.refreshTokens.delete(token);
      }
    }
    for (const [token, at] of this.accessTokens) {
      if (at.userId === userId) {
        this.accessTokens.delete(token);
      }
    }
  }

  saveAccessToken(token: AccessToken): void {
    this.accessTokens.set(token.token, token);
  }

  findAccessToken(token: string): AccessToken | undefined {
    const accessToken = this.accessTokens.get(token);
    if (accessToken && accessToken.expiresAt < Date.now()) {
      this.accessTokens.delete(token);
      return undefined;
    }
    return accessToken;
  }

  listProjects(ownerId: string): ProjectRecord[] {
    const result: ProjectRecord[] = [];
    for (const row of this.projects.values()) {
      if (row.ownerId === ownerId) {
        result.push(toPublicProject(row));
      }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  createProject(ownerId: string, input: ProjectInput): ProjectRecord {
    const now = Date.now();
    const row: ProjectRow = {
      id: generateId(),
      ownerId,
      title: input.title,
      author: input.author,
      language: input.language,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(row.id, row);
    return toPublicProject(row);
  }

  getProject(ownerId: string, id: string): ProjectRecord | undefined {
    const row = this.projects.get(id);
    return row && row.ownerId === ownerId ? toPublicProject(row) : undefined;
  }

  updateProject(
    ownerId: string,
    id: string,
    patch: ProjectInput,
  ): ProjectRecord | undefined {
    const row = this.projects.get(id);
    if (!row || row.ownerId !== ownerId) {
      return undefined;
    }
    if (patch.title !== undefined) {
      row.title = patch.title;
    }
    if (patch.author !== undefined) {
      row.author = patch.author;
    }
    if (patch.language !== undefined) {
      row.language = patch.language;
    }
    row.updatedAt = Date.now();
    return toPublicProject(row);
  }

  removeProject(ownerId: string, id: string): boolean {
    const row = this.projects.get(id);
    if (!row || row.ownerId !== ownerId) {
      return false;
    }
    this.projects.delete(id);
    this.files.delete(id);
    this.attachments.delete(id);
    this.docs.delete(id);
    return true;
  }

  listFiles(projectId: string): FileEntry[] {
    const map = this.files.get(projectId);
    if (!map) {
      return [];
    }
    return [...map.values()]
      .map(toFileEntry)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  readFile(projectId: string, path: string): StoredFile | undefined {
    return this.files.get(projectId)?.get(path);
  }

  writeFile(
    projectId: string,
    path: string,
    data: Uint8Array,
    contentType: string,
  ): FileEntry {
    let map = this.files.get(projectId);
    if (!map) {
      map = new Map();
      this.files.set(projectId, map);
    }
    const file: StoredFile = { path, data, contentType, updatedAt: Date.now() };
    map.set(path, file);
    return toFileEntry(file);
  }

  removeFile(projectId: string, path: string): boolean {
    return this.files.get(projectId)?.delete(path) ?? false;
  }

  readAttachment(projectId: string, sha256: string): Uint8Array | undefined {
    return this.attachments.get(projectId)?.get(sha256);
  }

  writeAttachment(projectId: string, sha256: string, data: Uint8Array): void {
    let map = this.attachments.get(projectId);
    if (!map) {
      map = new Map();
      this.attachments.set(projectId, map);
    }
    map.set(sha256, data);
  }

  loadDocState(projectId: string): Uint8Array | undefined {
    return this.docs.get(projectId);
  }

  saveDocState(projectId: string, state: Uint8Array): void {
    this.docs.set(projectId, state);
  }
}
