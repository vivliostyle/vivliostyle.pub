import { basename, dirname, join, sep } from 'pathe';

import {
  StorageConflictError,
  StorageError,
  StorageNotFoundError,
} from '../errors';
import type {
  FileMeta,
  ListEntry,
  ListOptions,
  ProviderCapabilities,
  ProviderMetadata,
  ReadOptions,
  RemoveOptions,
  RestoreOptions,
  Snapshot,
  SnapshotOptions,
  StorageProvider,
  WriteOptions,
} from '../types';

const dirHandleSymbol = Symbol('dirHandle');
interface DirTree {
  [dirHandleSymbol]: FileSystemDirectoryHandle;
  [child: string]: DirTree;
}

function normalize(path: string): string {
  return path.replace(/^\/+/, '');
}

function mapDomException(cause: unknown, path: string): StorageError {
  if (cause instanceof DOMException) {
    if (cause.name === 'NotFoundError') {
      return new StorageNotFoundError(path, { cause });
    }
    if (cause.name === 'TypeMismatchError') {
      return new StorageConflictError(path, { cause });
    }
    return new StorageError(`${cause.name}: ${path}`, { cause });
  }
  return new StorageError(`Failed at ${path}`, { cause });
}

export interface OPFSStorageProviderOptions {
  label?: string;
  description?: string;
}

export class OPFSStorageProvider implements StorageProvider {
  readonly metadata: ProviderMetadata;
  readonly capabilities: ProviderCapabilities = {
    versioning: false,
    binary: true,
    realtime: false,
    remote: false,
  };

  static async open(
    options: OPFSStorageProviderOptions & {
      subPath?: string;
      create?: boolean;
    } = {},
  ): Promise<OPFSStorageProvider> {
    const root = await navigator.storage.getDirectory();
    const handle = options.subPath
      ? await root.getDirectoryHandle(options.subPath, {
          create: options.create ?? true,
        })
      : root;
    return new OPFSStorageProvider(handle, options);
  }

  protected rootHandle: FileSystemDirectoryHandle;
  protected dirTreeCache: DirTree;

  constructor(
    rootHandle: FileSystemDirectoryHandle,
    options: OPFSStorageProviderOptions = {},
  ) {
    this.rootHandle = rootHandle;
    this.dirTreeCache = {
      [dirHandleSymbol]: rootHandle,
    } as DirTree;
    this.metadata = {
      kind: 'opfs',
      label: options.label ?? 'OPFS',
      description:
        options.description ?? 'Browser Origin Private File System storage',
    };
  }

  protected async resolveParent(
    path: string,
    create: boolean,
  ): Promise<[parent: FileSystemDirectoryHandle, name: string]> {
    const normalized = normalize(path);
    const base = basename(normalized);
    let current = this.dirTreeCache;
    for (const seg of dirname(normalized).split(sep)) {
      if (seg === '' || seg === '.') continue;
      let next = current[seg];
      if (!next) {
        try {
          const handle = await current[dirHandleSymbol].getDirectoryHandle(
            seg,
            { create },
          );
          next = { [dirHandleSymbol]: handle } as DirTree;
          current[seg] = next;
        } catch (cause) {
          throw mapDomException(cause, path);
        }
      }
      current = next;
    }
    return [current[dirHandleSymbol], base];
  }

  async exists(path: string): Promise<boolean> {
    let parent: FileSystemDirectoryHandle;
    let name: string;
    try {
      [parent, name] = await this.resolveParent(path, false);
    } catch {
      return false;
    }
    try {
      await parent.getFileHandle(name);
      return true;
    } catch {
      try {
        await parent.getDirectoryHandle(name);
        return true;
      } catch {
        return false;
      }
    }
  }

  async read(path: string, _options?: ReadOptions): Promise<Uint8Array> {
    try {
      const [parent, name] = await this.resolveParent(path, false);
      const fileHandle = await parent.getFileHandle(name);
      const file = await fileHandle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (cause) {
      if (cause instanceof StorageError) throw cause;
      throw mapDomException(cause, path);
    }
  }

  async write(
    path: string,
    data: Uint8Array,
    _options?: WriteOptions,
  ): Promise<void> {
    const [parent, name] = await this.resolveParent(path, true);
    const fileHandle = await parent.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    // Copy partial views before writing: WebKit's write() ignores a view's
    // byteOffset/byteLength and writes the entire underlying ArrayBuffer,
    // corrupting the file. The cast widens Uint8Array<ArrayBufferLike> to
    // satisfy TS expecting ArrayBufferView<ArrayBuffer>.
    const chunk =
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? data
        : data.slice();
    await writable.write(chunk as unknown as BufferSource);
    await writable.close();
  }

  async remove(path: string, options?: RemoveOptions): Promise<void> {
    const [parent, name] = await this.resolveParent(path, false);
    try {
      await parent.removeEntry(name, {
        recursive: options?.recursive ?? false,
      });
      this.invalidateCachePath(path);
    } catch (cause) {
      if (cause instanceof StorageError) throw cause;
      throw mapDomException(cause, path);
    }
  }

  protected invalidateCachePath(path: string): void {
    const normalized = normalize(path);
    if (!normalized) {
      for (const key of Object.keys(this.dirTreeCache)) {
        delete this.dirTreeCache[key];
      }
      return;
    }
    let current: DirTree = this.dirTreeCache;
    for (const seg of dirname(normalized).split(sep)) {
      if (seg === '' || seg === '.') continue;
      const next = current[seg];
      if (!next) return;
      current = next;
    }
    delete current[basename(normalized)];
  }

  async stat(path: string): Promise<FileMeta | null> {
    try {
      const [parent, name] = await this.resolveParent(path, false);
      const fileHandle = await parent.getFileHandle(name);
      const file = await fileHandle.getFile();
      return { size: file.size, mtimeMs: file.lastModified };
    } catch {
      return null;
    }
  }

  async list(path: string, options?: ListOptions): Promise<ListEntry[]> {
    const normalized = normalize(path);
    const baseHandle =
      normalized === ''
        ? this.rootHandle
        : await this.descendDirectory(normalized);
    if (!baseHandle) return [];

    const entries: ListEntry[] = [];
    const ignore = options?.ignore ?? [];

    if (options?.recursive) {
      await this.walkRecursive(baseHandle, normalized, ignore, entries);
    } else {
      for await (const [name, entry] of baseHandle.entries()) {
        const entryPath = normalized ? join(normalized, name) : name;
        if (ignore.some((re) => re.test(entryPath))) continue;
        entries.push({
          path: entryPath,
          kind: entry.kind === 'file' ? 'file' : 'directory',
        });
      }
    }
    return entries;
  }

  protected async descendDirectory(
    relativePath: string,
  ): Promise<FileSystemDirectoryHandle | null> {
    let current = this.rootHandle;
    for (const seg of relativePath.split(sep)) {
      if (seg === '' || seg === '.') continue;
      try {
        current = await current.getDirectoryHandle(seg);
      } catch {
        return null;
      }
    }
    return current;
  }

  protected async walkRecursive(
    dir: FileSystemDirectoryHandle,
    parent: string,
    ignore: readonly RegExp[],
    out: ListEntry[],
  ): Promise<void> {
    for await (const [name, entry] of dir.entries()) {
      const entryPath = parent ? join(parent, name) : name;
      if (ignore.some((re) => re.test(entryPath))) continue;
      if (entry.kind === 'file') {
        out.push({ path: entryPath, kind: 'file' });
      } else {
        out.push({ path: entryPath, kind: 'directory' });
        await this.walkRecursive(
          entry as FileSystemDirectoryHandle,
          entryPath,
          ignore,
          out,
        );
      }
    }
  }

  async snapshot(path: string, options?: SnapshotOptions): Promise<Snapshot> {
    const format = options?.format ?? 'memfs-json';
    if (format !== 'memfs-json') {
      throw new StorageError(
        `OPFSStorageProvider does not support snapshot format: ${format}`,
      );
    }
    const normalized = normalize(path);
    const baseHandle =
      normalized === ''
        ? this.rootHandle
        : await this.descendDirectory(normalized);
    if (!baseHandle) {
      return { format: 'memfs-json', data: {} };
    }
    const data: Record<string, Uint8Array> = {};
    const ignore = options?.ignore ?? [];
    const collect = async (
      dir: FileSystemDirectoryHandle,
      relativeParent: string,
    ): Promise<void> => {
      const tasks: Promise<void>[] = [];
      for await (const [name, entry] of dir.entries()) {
        const subPath = relativeParent ? join(relativeParent, name) : name;
        if (ignore.some((re) => re.test(subPath))) continue;
        if (entry.kind === 'file') {
          tasks.push(
            (async () => {
              const file = await (entry as FileSystemFileHandle).getFile();
              data[`/${subPath}`] = new Uint8Array(await file.arrayBuffer());
            })(),
          );
        } else if (entry.kind === 'directory') {
          tasks.push(collect(entry as FileSystemDirectoryHandle, subPath));
        }
      }
      await Promise.all(tasks);
    };
    await collect(baseHandle, '');
    return { format: 'memfs-json', data };
  }

  async restore(
    path: string,
    snapshot: Snapshot,
    options?: RestoreOptions,
  ): Promise<void> {
    if (snapshot.format !== 'memfs-json') {
      throw new StorageError(
        `OPFSStorageProvider does not support snapshot format: ${snapshot.format}`,
      );
    }
    if (options?.clean) {
      if (normalize(path) === '') {
        const entries = await this.list('');
        for (const entry of entries) {
          try {
            await this.remove(entry.path, { recursive: true });
          } catch {
            // ignore (entry may have been concurrently removed)
          }
        }
      } else {
        try {
          await this.remove(path, { recursive: true });
        } catch {
          // ignore (may not exist yet)
        }
      }
    }
    const prefix = normalize(path);
    for (const [filePath, content] of Object.entries(snapshot.data)) {
      if (content === null) continue;
      const targetPath = prefix
        ? join(prefix, normalize(filePath))
        : normalize(filePath);
      if (typeof content === 'string') {
        await this.write(targetPath, new TextEncoder().encode(content));
      } else {
        await this.write(targetPath, content);
      }
    }
  }
}
