import { join } from 'pathe';

import { StorageError, StorageNotFoundError } from '../errors';
import type {
  BatchChanges,
  FileMeta,
  ListEntry,
  ListOptions,
  ProviderCapabilities,
  ProviderMetadata,
  RemoveOptions,
  RestoreOptions,
  Snapshot,
  SnapshotOptions,
  StorageProvider,
  WriteOptions,
} from '../types';

interface RemoteFileEntry {
  path: string;
  size: number;
  contentType: string;
  updatedAt: number;
  /** SHA-256 hex of the content, when the server provides it. */
  hash?: string;
  /** Short-lived URL for fetching the bytes directly, when requested. */
  downloadUrl?: string;
}

interface RemoteFileWrite {
  path: string;
  data: Uint8Array;
  contentType?: string;
}

/**
 * The file operations RemoteHttpStorageProvider needs. `@v/api-client`'s
 * `ApiClient` satisfies this structurally.
 */
export interface RemoteFileApi {
  listFiles(
    projectId: string,
    options?: { download?: boolean },
  ): Promise<RemoteFileEntry[]>;
  readFile(projectId: string, path: string): Promise<Uint8Array | null>;
  writeFile(
    projectId: string,
    path: string,
    data: Uint8Array,
    contentType?: string,
  ): Promise<void>;
  writeFiles(
    projectId: string,
    changes: { writes?: RemoteFileWrite[]; deletes?: string[] },
  ): Promise<RemoteFileEntry[]>;
  deleteFile(projectId: string, path: string): Promise<void>;
  fetchDownloadUrl(url: string): Promise<Uint8Array>;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === status
  );
}

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  css: 'text/css',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function normalize(path: string): string {
  return path.replace(/^\/+/, '');
}

export interface RemoteHttpStorageProviderOptions {
  label?: string;
  description?: string;
}

/**
 * StorageProvider backed by a remote sync server's file endpoints. The server
 * stores a flat namespace of file paths per project; directories are synthesized
 * from path prefixes. Realtime collaboration is handled separately by the sync
 * client, so `realtime` is false here.
 */
export class RemoteHttpStorageProvider implements StorageProvider {
  readonly metadata: ProviderMetadata;
  readonly capabilities: ProviderCapabilities = {
    versioning: false,
    binary: true,
    realtime: false,
    remote: true,
  };

  constructor(
    private readonly api: RemoteFileApi,
    private readonly projectId: string,
    options: RemoteHttpStorageProviderOptions = {},
  ) {
    this.metadata = {
      kind: 'remote',
      label: options.label ?? 'Remote',
      description: options.description ?? 'Remote sync server storage',
    };
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async read(path: string): Promise<Uint8Array> {
    const normalized = normalize(path);
    let data: Uint8Array | null;
    try {
      data = await this.api.readFile(this.projectId, normalized);
    } catch (cause) {
      throw new StorageError(`Failed to read ${path}`, { cause });
    }
    if (data === null) {
      throw new StorageNotFoundError(path);
    }
    return data;
  }

  async write(
    path: string,
    data: Uint8Array,
    options?: WriteOptions,
  ): Promise<void> {
    const normalized = normalize(path);
    try {
      await this.api.writeFile(
        this.projectId,
        normalized,
        data,
        options?.mimeType ?? guessMimeType(normalized),
      );
    } catch (cause) {
      throw new StorageError(`Failed to write ${path}`, { cause });
    }
  }

  async applyBatch(changes: BatchChanges): Promise<void> {
    const writes: RemoteFileWrite[] = (changes.writes ?? []).map((write) => ({
      path: normalize(write.path),
      data: write.data,
      contentType: write.mimeType ?? guessMimeType(write.path),
    }));
    const deletes = (changes.deletes ?? []).map(normalize);
    if (writes.length === 0 && deletes.length === 0) {
      return;
    }
    try {
      await this.api.writeFiles(this.projectId, { writes, deletes });
    } catch (cause) {
      // Older servers without the batch endpoint answer 404; fall back to the
      // per-file endpoints so a version skew still completes.
      if (!hasStatus(cause, 404)) {
        throw new StorageError('Failed to write files', { cause });
      }
      await Promise.all([
        ...writes.map((write) =>
          this.api.writeFile(
            this.projectId,
            write.path,
            write.data,
            write.contentType,
          ),
        ),
        ...deletes.map((path) => this.api.deleteFile(this.projectId, path)),
      ]);
    }
  }

  async readMany(paths: readonly string[]): Promise<Map<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>();
    if (paths.length === 0) {
      return result;
    }
    const wanted = new Set(paths.map(normalize));
    let entries: RemoteFileEntry[];
    try {
      entries = await this.api.listFiles(this.projectId, { download: true });
    } catch (cause) {
      throw new StorageError('Failed to list files', { cause });
    }
    await Promise.all(
      entries
        .filter((entry) => wanted.has(entry.path))
        .map(async (entry) => {
          const bytes = await this.fetchEntryBytes(entry);
          if (bytes) {
            result.set(entry.path, bytes);
          }
        }),
    );
    return result;
  }

  // Prefer the direct-download URL (free egress, no API hop) and fall back to
  // the API byte endpoint when the server did not hand one out.
  private async fetchEntryBytes(
    entry: RemoteFileEntry,
  ): Promise<Uint8Array | null> {
    if (entry.downloadUrl) {
      try {
        return await this.api.fetchDownloadUrl(entry.downloadUrl);
      } catch {
        // fall through to the API endpoint
      }
    }
    return this.api.readFile(this.projectId, entry.path);
  }

  async remove(path: string, options?: RemoveOptions): Promise<void> {
    const normalized = normalize(path);
    try {
      if (options?.recursive) {
        const files = await this.api.listFiles(this.projectId);
        const targets = normalized
          ? files.filter(
              (file) =>
                file.path === normalized ||
                file.path.startsWith(`${normalized}/`),
            )
          : files;
        await Promise.all(
          targets.map((file) => this.api.deleteFile(this.projectId, file.path)),
        );
        return;
      }
      await this.api.deleteFile(this.projectId, normalized);
    } catch (cause) {
      throw new StorageError(`Failed to remove ${path}`, { cause });
    }
  }

  async stat(path: string): Promise<FileMeta | null> {
    const normalized = normalize(path);
    const files = await this.api.listFiles(this.projectId);
    const entry = files.find((file) => file.path === normalized);
    if (!entry) {
      return null;
    }
    return {
      size: entry.size,
      mtimeMs: entry.updatedAt,
      mimeType: entry.contentType,
    };
  }

  async list(path: string, options?: ListOptions): Promise<ListEntry[]> {
    const normalized = normalize(path);
    const prefix = normalized ? `${normalized}/` : '';
    const ignore = options?.ignore ?? [];
    const files = await this.api.listFiles(this.projectId);
    const entries: ListEntry[] = [];
    const seenDirs = new Set<string>();

    for (const file of files) {
      if (prefix && !file.path.startsWith(prefix)) {
        continue;
      }
      const rel = file.path.slice(prefix.length);
      if (!rel) {
        continue;
      }
      if (options?.recursive) {
        if (ignore.some((re) => re.test(file.path))) {
          continue;
        }
        entries.push({
          path: file.path,
          kind: 'file',
          meta: {
            size: file.size,
            mtimeMs: file.updatedAt,
            mimeType: file.contentType,
          },
        });
        continue;
      }
      const slash = rel.indexOf('/');
      if (slash === -1) {
        if (ignore.some((re) => re.test(file.path))) {
          continue;
        }
        entries.push({
          path: file.path,
          kind: 'file',
          meta: {
            size: file.size,
            mtimeMs: file.updatedAt,
            mimeType: file.contentType,
          },
        });
      } else {
        const dirPath = `${prefix}${rel.slice(0, slash)}`;
        if (!seenDirs.has(dirPath) && !ignore.some((re) => re.test(dirPath))) {
          seenDirs.add(dirPath);
          entries.push({ path: dirPath, kind: 'directory' });
        }
      }
    }
    return entries;
  }

  async snapshot(path: string, options?: SnapshotOptions): Promise<Snapshot> {
    const format = options?.format ?? 'memfs-json';
    if (format !== 'memfs-json') {
      throw new StorageError(
        `RemoteHttpStorageProvider does not support snapshot format: ${format}`,
      );
    }
    const normalized = normalize(path);
    const prefix = normalized ? `${normalized}/` : '';
    const ignore = options?.ignore ?? [];
    const entries = await this.api.listFiles(this.projectId, {
      download: true,
    });
    const data: Record<string, Uint8Array> = {};
    await Promise.all(
      entries.map(async (entry) => {
        if (prefix && !entry.path.startsWith(prefix)) {
          return;
        }
        const rel = entry.path.slice(prefix.length);
        if (!rel) {
          return;
        }
        // Match OPFSStorageProvider: ignore patterns apply to the path
        // relative to the snapshot base, not the project-root path.
        if (ignore.some((re) => re.test(rel))) {
          return;
        }
        const bytes = await this.fetchEntryBytes(entry);
        if (bytes) {
          data[`/${rel}`] = bytes;
        }
      }),
    );
    return { format: 'memfs-json', data };
  }

  async restore(
    path: string,
    snapshot: Snapshot,
    options?: RestoreOptions,
  ): Promise<void> {
    if (snapshot.format !== 'memfs-json') {
      throw new StorageError(
        `RemoteHttpStorageProvider does not support snapshot format: ${snapshot.format}`,
      );
    }
    const prefix = normalize(path);
    const desired = new Map<string, Uint8Array>();
    for (const [filePath, content] of Object.entries(snapshot.data)) {
      if (content === null) {
        continue;
      }
      const targetPath = prefix
        ? join(prefix, normalize(filePath))
        : normalize(filePath);
      desired.set(
        targetPath,
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content,
      );
    }

    // Diff against the server so unchanged files are not re-uploaded.
    let serverEntries: RemoteFileEntry[] = [];
    try {
      serverEntries = await this.api.listFiles(this.projectId);
    } catch {
      // Treat an unreadable listing as an empty project: upload everything.
    }
    const serverHashes = new Map(
      serverEntries.map((entry) => [entry.path, entry.hash]),
    );

    const writes: { path: string; data: Uint8Array }[] = [];
    for (const [targetPath, bytes] of desired) {
      const existing = serverHashes.get(targetPath);
      if (existing && existing === (await sha256Hex(bytes))) {
        continue;
      }
      writes.push({ path: targetPath, data: bytes });
    }

    const deletes: string[] = [];
    if (options?.clean) {
      for (const entry of serverEntries) {
        if (
          prefix &&
          entry.path !== prefix &&
          !entry.path.startsWith(`${prefix}/`)
        ) {
          continue;
        }
        if (!desired.has(entry.path)) {
          deletes.push(entry.path);
        }
      }
    }

    await this.applyBatch({ writes, deletes });
  }
}
