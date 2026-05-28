import * as nodeFs from 'node:fs/promises';
import { create as createVfs, type VirtualFileSystem } from '@platformatic/vfs';
import { dirname, join, normalize } from 'pathe';

import type { FileEntry } from '../schemas';

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

function guessMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function assertProjectId(projectId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error(`Invalid project id: ${projectId}`);
  }
}

function assertSha256(sha256: string): void {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`Invalid sha256: ${sha256}`);
  }
}

function safeRelative(input: string): string {
  const stripped = input.replace(/^\/+/, '');
  const normalized = normalize(stripped);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/..')
  ) {
    throw new Error(`Invalid file path: ${input}`);
  }
  return normalized;
}

function toBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

// Subset shared by `node:fs/promises` and `@platformatic/vfs`'s promises API,
// so `node:vfs` can later replace either backend without touching callers.
interface FsLike {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer): Promise<void>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{
    size: number;
    mtimeMs: number;
    isFile(): boolean;
    isDirectory(): boolean;
  }>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<
    Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>
  >;
  rmdir(path: string): Promise<void>;
}

export interface FileStoreOptions {
  // Layout: `<basePath>/<projectId>/{files,attachments}/...`. Unset → in-memory.
  basePath?: string;
}

export interface FileStoreFile {
  path: string;
  data: Uint8Array;
  contentType: string;
  updatedAt: number;
}

// No sidecar metadata: content types are re-derived from the file extension
// on every read so users can edit / version-control the on-disk layout
// directly.
export class FileStore {
  private fs: FsLike;
  private root: string;
  private vfs: VirtualFileSystem | undefined;

  constructor(options: FileStoreOptions = {}) {
    if (options.basePath) {
      this.fs = nodeFs as unknown as FsLike;
      this.root = normalize(options.basePath);
    } else {
      this.vfs = createVfs();
      // `VirtualStats` / `VirtualDirent` are structurally compatible with the
      // `FsLike` shape but TypeScript can't prove it.
      this.fs = this.vfs.promises as unknown as FsLike;
      this.root = '/';
    }
  }

  private projectDir(projectId: string): string {
    return join(this.root, projectId);
  }

  private filesDir(projectId: string): string {
    return join(this.projectDir(projectId), 'files');
  }

  private attachmentsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'attachments');
  }

  async listFiles(projectId: string): Promise<FileEntry[]> {
    assertProjectId(projectId);
    const baseDir = this.filesDir(projectId);
    const out: FileEntry[] = [];
    await this.walkFiles(baseDir, '', out);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(
    projectId: string,
    filePath: string,
  ): Promise<FileStoreFile | undefined> {
    assertProjectId(projectId);
    const rel = safeRelative(filePath);
    const target = join(this.filesDir(projectId), rel);
    try {
      const data = await this.fs.readFile(target);
      const stat = await this.fs.stat(target);
      return {
        path: rel,
        data: toUint8Array(data),
        contentType: guessMimeType(rel),
        updatedAt: Math.floor(stat.mtimeMs),
      };
    } catch (err) {
      if (isENOENT(err)) return undefined;
      throw err;
    }
  }

  async writeFile(
    projectId: string,
    filePath: string,
    data: Uint8Array,
  ): Promise<FileEntry> {
    assertProjectId(projectId);
    const rel = safeRelative(filePath);
    const target = join(this.filesDir(projectId), rel);
    await this.fs.mkdir(dirname(target), { recursive: true });
    await this.fs.writeFile(target, toBuffer(data));
    const stat = await this.fs.stat(target);
    return {
      path: rel,
      size: stat.size,
      contentType: guessMimeType(rel),
      updatedAt: Math.floor(stat.mtimeMs),
    };
  }

  async removeFile(projectId: string, filePath: string): Promise<boolean> {
    assertProjectId(projectId);
    const rel = safeRelative(filePath);
    const target = join(this.filesDir(projectId), rel);
    try {
      await this.fs.unlink(target);
      return true;
    } catch (err) {
      if (isENOENT(err)) return false;
      throw err;
    }
  }

  async removeProject(projectId: string): Promise<void> {
    assertProjectId(projectId);
    await this.removeTree(this.projectDir(projectId));
  }

  async readAttachment(
    projectId: string,
    sha256: string,
  ): Promise<Uint8Array | undefined> {
    assertProjectId(projectId);
    if (!/^[0-9a-f]{64}$/.test(sha256)) return undefined;
    const target = join(this.attachmentsDir(projectId), sha256);
    try {
      const data = await this.fs.readFile(target);
      return toUint8Array(data);
    } catch (err) {
      if (isENOENT(err)) return undefined;
      throw err;
    }
  }

  async writeAttachment(
    projectId: string,
    sha256: string,
    data: Uint8Array,
  ): Promise<void> {
    assertProjectId(projectId);
    assertSha256(sha256);
    const target = join(this.attachmentsDir(projectId), sha256);
    await this.fs.mkdir(dirname(target), { recursive: true });
    await this.fs.writeFile(target, toBuffer(data));
  }

  private async walkFiles(
    dir: string,
    prefix: string,
    out: FileEntry[],
  ): Promise<void> {
    let entries: Array<{
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
    }>;
    try {
      entries = await this.fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isENOENT(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const child = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.walkFiles(child, rel, out);
      } else if (entry.isFile()) {
        const stat = await this.fs.stat(child);
        out.push({
          path: rel,
          size: stat.size,
          contentType: guessMimeType(rel),
          updatedAt: Math.floor(stat.mtimeMs),
        });
      }
    }
  }

  private async removeTree(dirPath: string): Promise<void> {
    let entries: Array<{
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
    }>;
    try {
      entries = await this.fs.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      if (isENOENT(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const child = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.removeTree(child);
      } else {
        try {
          await this.fs.unlink(child);
        } catch (err) {
          if (!isENOENT(err)) throw err;
        }
      }
    }
    try {
      await this.fs.rmdir(dirPath);
    } catch (err) {
      if (!isENOENT(err)) throw err;
    }
  }
}
