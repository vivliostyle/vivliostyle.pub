import { beforeEach, describe, expect, it } from 'vitest';

import {
  StorageConflictError,
  StorageError,
  StorageNotFoundError,
} from '../errors';
import type { Snapshot } from '../types';
import { OPFSStorageProvider } from './opfs';

class MockFileSystemFileHandle {
  readonly kind = 'file' as const;
  data: Uint8Array;
  lastModified: number;

  constructor(
    public name: string,
    data: Uint8Array = new Uint8Array(),
  ) {
    this.data = data;
    this.lastModified = Date.now();
  }

  async getFile(): Promise<File> {
    const data = this.data;
    const lastModified = this.lastModified;
    return {
      size: data.byteLength,
      lastModified,
      type: '',
      name: this.name,
      arrayBuffer: async () => {
        const buf = new ArrayBuffer(data.byteLength);
        new Uint8Array(buf).set(data);
        return buf;
      },
    } as unknown as File;
  }

  lastWrittenChunk: Blob | Uint8Array | string | null = null;

  async createWritable() {
    let buffered: Uint8Array | null = null;
    return {
      write: async (chunk: Blob | Uint8Array | string) => {
        this.lastWrittenChunk = chunk;
        if (chunk instanceof Blob) {
          buffered = new Uint8Array(await chunk.arrayBuffer());
        } else if (chunk instanceof Uint8Array) {
          buffered = new Uint8Array(chunk);
        } else if (typeof chunk === 'string') {
          buffered = new TextEncoder().encode(chunk);
        }
      },
      close: async () => {
        if (buffered) {
          this.data = buffered;
          this.lastModified = Date.now();
        }
      },
    };
  }
}

type Child = MockFileSystemDirectoryHandle | MockFileSystemFileHandle;

class MockFileSystemDirectoryHandle {
  readonly kind = 'directory' as const;
  children = new Map<string, Child>();

  constructor(public name: string = '') {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MockFileSystemDirectoryHandle> {
    let child = this.children.get(name);
    if (!child) {
      if (!options?.create) {
        throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
      }
      child = new MockFileSystemDirectoryHandle(name);
      this.children.set(name, child);
    }
    if (child.kind !== 'directory') {
      throw new DOMException(
        `Entry exists but is not a directory: ${name}`,
        'TypeMismatchError',
      );
    }
    return child;
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MockFileSystemFileHandle> {
    let child = this.children.get(name);
    if (!child) {
      if (!options?.create) {
        throw new DOMException(`File not found: ${name}`, 'NotFoundError');
      }
      child = new MockFileSystemFileHandle(name);
      this.children.set(name, child);
    }
    if (child.kind !== 'file') {
      throw new DOMException(
        `Entry exists but is not a file: ${name}`,
        'TypeMismatchError',
      );
    }
    return child;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    const child = this.children.get(name);
    if (!child) {
      throw new DOMException(`Entry not found: ${name}`, 'NotFoundError');
    }
    if (
      child.kind === 'directory' &&
      child.children.size > 0 &&
      !options?.recursive
    ) {
      throw new DOMException(
        `Directory not empty: ${name}`,
        'InvalidModificationError',
      );
    }
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, Child]> {
    for (const [name, child] of this.children) {
      yield [name, child];
    }
  }
}

function makeProvider(): OPFSStorageProvider {
  const root = new MockFileSystemDirectoryHandle();
  return new OPFSStorageProvider(root as unknown as FileSystemDirectoryHandle);
}

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('OPFSStorageProvider', () => {
  describe('metadata & capabilities', () => {
    it('exposes default metadata and read-only capabilities', () => {
      const p = makeProvider();
      expect(p.metadata.kind).toBe('opfs');
      expect(p.metadata.label).toBe('OPFS');
      expect(typeof p.metadata.description).toBe('string');
      expect(p.capabilities).toEqual({
        versioning: false,
        binary: true,
        realtime: false,
        remote: false,
      });
    });

    it('honors label and description overrides', () => {
      const root = new MockFileSystemDirectoryHandle();
      const p = new OPFSStorageProvider(
        root as unknown as FileSystemDirectoryHandle,
        { label: 'Drafts', description: 'Local drafts area' },
      );
      expect(p.metadata.label).toBe('Drafts');
      expect(p.metadata.description).toBe('Local drafts area');
    });
  });

  describe('write & read', () => {
    let provider: OPFSStorageProvider;
    beforeEach(() => {
      provider = makeProvider();
    });

    it('round-trips a top-level file', async () => {
      await provider.write('greeting.txt', encode('hello world'));
      expect(decode(await provider.read('greeting.txt'))).toBe('hello world');
    });

    it('creates parent directories on nested write', async () => {
      await provider.write('a/b/c.txt', encode('nested'));
      expect(decode(await provider.read('a/b/c.txt'))).toBe('nested');
    });

    it('normalizes leading slashes', async () => {
      await provider.write('/leading.txt', encode('OK'));
      expect(decode(await provider.read('/leading.txt'))).toBe('OK');
      expect(decode(await provider.read('leading.txt'))).toBe('OK');
    });

    it('overwrites existing files on write', async () => {
      await provider.write('mut.txt', encode('first'));
      await provider.write('mut.txt', encode('second'));
      expect(decode(await provider.read('mut.txt'))).toBe('second');
    });

    // WebKit's FileSystemWritableFileStream.write() ignores a view's
    // byteOffset/byteLength and writes the entire underlying ArrayBuffer.
    it('never passes a partial view to createWritable', async () => {
      const root = new MockFileSystemDirectoryHandle();
      const p = new OPFSStorageProvider(
        root as unknown as FileSystemDirectoryHandle,
      );
      const backing = new Uint8Array(64).fill(0x41);
      const view = backing.subarray(8, 16).fill(0x42);
      await p.write('view.bin', view);
      const handle = root.children.get('view.bin') as MockFileSystemFileHandle;
      const chunk = handle.lastWrittenChunk as Uint8Array;
      expect(chunk.byteOffset).toBe(0);
      expect(chunk.byteLength).toBe(chunk.buffer.byteLength);
      expect(decode(await p.read('view.bin'))).toBe('BBBBBBBB');
    });

    it('throws StorageNotFoundError when reading a missing file', async () => {
      await expect(provider.read('missing.txt')).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });

    it('throws StorageConflictError when a parent segment is a file', async () => {
      await provider.write('a', encode('I am a file, not a dir'));
      await expect(
        provider.write('a/child.txt', encode('x')),
      ).rejects.toBeInstanceOf(StorageConflictError);
    });

    it('throws StorageConflictError when reading through a file-as-parent', async () => {
      await provider.write('a', encode('I am a file'));
      await expect(provider.read('a/child.txt')).rejects.toBeInstanceOf(
        StorageConflictError,
      );
    });
  });

  describe('exists', () => {
    it('returns true for files, true for directories, false for missing', async () => {
      const provider = makeProvider();
      await provider.write('a/b.txt', new Uint8Array([1, 2, 3]));
      expect(await provider.exists('a/b.txt')).toBe(true);
      expect(await provider.exists('a')).toBe(true);
      expect(await provider.exists('missing.txt')).toBe(false);
      expect(await provider.exists('a/missing')).toBe(false);
    });
  });

  describe('remove', () => {
    it('removes a file', async () => {
      const provider = makeProvider();
      await provider.write('temp.txt', new Uint8Array());
      await provider.remove('temp.txt');
      expect(await provider.exists('temp.txt')).toBe(false);
    });

    it('removes a directory recursively when requested', async () => {
      const provider = makeProvider();
      await provider.write('proj/x.txt', encode('x'));
      await provider.write('proj/sub/y.txt', encode('y'));
      await provider.remove('proj', { recursive: true });
      expect(await provider.exists('proj')).toBe(false);
    });

    it('throws StorageNotFoundError when removing a missing entry', async () => {
      const provider = makeProvider();
      await expect(provider.remove('missing.txt')).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });
  });

  describe('stat', () => {
    it('returns size and mtime for an existing file', async () => {
      const provider = makeProvider();
      await provider.write('sized.txt', new Uint8Array([1, 2, 3, 4, 5]));
      const stat = await provider.stat('sized.txt');
      expect(stat?.size).toBe(5);
      expect(typeof stat?.mtimeMs).toBe('number');
    });

    it('returns null for a missing file', async () => {
      const provider = makeProvider();
      expect(await provider.stat('missing')).toBeNull();
    });
  });

  describe('list', () => {
    let provider: OPFSStorageProvider;
    beforeEach(async () => {
      provider = makeProvider();
      await provider.write('a.txt', encode('A'));
      await provider.write('sub/b.txt', encode('B'));
      await provider.write('sub/inner/c.txt', encode('C'));
      await provider.write('node_modules/foo/bar.js', encode('NM'));
      await provider.write('.vivliostyle/cache.bin', encode('CACHE'));
    });

    it('lists only immediate children when recursive is not set', async () => {
      const entries = await provider.list('');
      const paths = entries.map((e) => e.path).sort();
      expect(paths).toEqual(
        ['.vivliostyle', 'a.txt', 'node_modules', 'sub'].sort(),
      );
      const aTxt = entries.find((e) => e.path === 'a.txt');
      const sub = entries.find((e) => e.path === 'sub');
      expect(aTxt?.kind).toBe('file');
      expect(sub?.kind).toBe('directory');
    });

    it('lists all descendants when recursive is true', async () => {
      const entries = await provider.list('', { recursive: true });
      const paths = entries.map((e) => e.path);
      expect(paths).toContain('a.txt');
      expect(paths).toContain('sub/b.txt');
      expect(paths).toContain('sub/inner/c.txt');
    });

    it('applies ignore patterns during recursive listing', async () => {
      const entries = await provider.list('', {
        recursive: true,
        ignore: [/^node_modules/, /^\.vivliostyle/],
      });
      const paths = entries.map((e) => e.path);
      expect(paths).toContain('a.txt');
      expect(paths).toContain('sub/b.txt');
      expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
      expect(paths.some((p) => p.startsWith('.vivliostyle'))).toBe(false);
    });

    it('returns an empty list for a missing path', async () => {
      const empty = await provider.list('does/not/exist');
      expect(empty).toEqual([]);
    });

    it('lists immediate children of a sub-directory', async () => {
      const entries = await provider.list('sub');
      const paths = entries.map((e) => e.path).sort();
      expect(paths).toEqual(['sub/b.txt', 'sub/inner']);
    });
  });

  describe('snapshot & restore', () => {
    it('round-trips a directory tree between providers', async () => {
      const source = makeProvider();
      await source.write('a.txt', encode('A'));
      await source.write('dir/b.txt', encode('B'));
      await source.write('dir/sub/c.txt', encode('C'));

      const snap = await source.snapshot('');

      const target = makeProvider();
      await target.restore('', snap);

      expect(decode(await target.read('a.txt'))).toBe('A');
      expect(decode(await target.read('dir/b.txt'))).toBe('B');
      expect(decode(await target.read('dir/sub/c.txt'))).toBe('C');
    });

    it('produces a memfs-json snapshot keyed by absolute paths', async () => {
      const provider = makeProvider();
      await provider.write('a.txt', encode('A'));
      await provider.write('dir/b.txt', encode('B'));
      const snap = await provider.snapshot('');
      expect(snap.format).toBe('memfs-json');
      if (snap.format === 'memfs-json') {
        expect(Object.keys(snap.data).sort()).toEqual(['/a.txt', '/dir/b.txt']);
      }
    });

    it('applies ignore patterns when snapshotting', async () => {
      const provider = makeProvider();
      await provider.write('keep.txt', encode('K'));
      await provider.write('node_modules/x.js', encode('X'));
      const snap = await provider.snapshot('', {
        ignore: [/^node_modules/],
      });
      expect(snap.format).toBe('memfs-json');
      if (snap.format === 'memfs-json') {
        expect(Object.keys(snap.data)).toEqual(['/keep.txt']);
      }
    });

    it('rejects unsupported snapshot formats', async () => {
      const provider = makeProvider();
      await expect(
        provider.snapshot('', { format: 'cbor' }),
      ).rejects.toBeInstanceOf(StorageError);
    });

    it('returns an empty snapshot for a missing source path', async () => {
      const provider = makeProvider();
      const snap = await provider.snapshot('missing');
      expect(snap.format).toBe('memfs-json');
      if (snap.format === 'memfs-json') {
        expect(snap.data).toEqual({});
      }
    });

    it('accepts string content in restore data', async () => {
      const provider = makeProvider();
      const snap: Snapshot = {
        format: 'memfs-json',
        data: { '/foo.txt': 'string content' },
      };
      await provider.restore('', snap);
      expect(decode(await provider.read('foo.txt'))).toBe('string content');
    });

    it('skips null entries during restore', async () => {
      const provider = makeProvider();
      await provider.write('existing.txt', new Uint8Array([1]));
      const snap: Snapshot = {
        format: 'memfs-json',
        data: {
          '/skipped.txt': null,
          '/written.txt': encode('written'),
        },
      };
      await provider.restore('', snap);
      expect(await provider.exists('skipped.txt')).toBe(false);
      expect(decode(await provider.read('written.txt'))).toBe('written');
      expect(await provider.exists('existing.txt')).toBe(true);
    });

    it('restores into a sub-path prefix', async () => {
      const provider = makeProvider();
      const snap: Snapshot = {
        format: 'memfs-json',
        data: { '/new.txt': encode('fresh') },
      };
      await provider.restore('proj', snap);
      expect(decode(await provider.read('proj/new.txt'))).toBe('fresh');
    });

    it('clears the sub-path before restore when clean=true', async () => {
      const provider = makeProvider();
      await provider.write('proj/old.txt', encode('old'));
      const snap: Snapshot = {
        format: 'memfs-json',
        data: { '/new.txt': encode('new') },
      };
      await provider.restore('proj', snap, { clean: true });
      expect(await provider.exists('proj/old.txt')).toBe(false);
      expect(decode(await provider.read('proj/new.txt'))).toBe('new');
    });

    it('clears the root before restore when clean=true and path is empty', async () => {
      const provider = makeProvider();
      await provider.write('stale.txt', encode('stale'));
      await provider.write('stale-dir/x.txt', encode('stale'));
      const snap: Snapshot = {
        format: 'memfs-json',
        data: { '/fresh.txt': encode('fresh') },
      };
      await provider.restore('', snap, { clean: true });
      expect(await provider.exists('stale.txt')).toBe(false);
      expect(await provider.exists('stale-dir')).toBe(false);
      expect(decode(await provider.read('fresh.txt'))).toBe('fresh');
    });

    it('rejects restore with unsupported snapshot format', async () => {
      const provider = makeProvider();
      const snap = {
        format: 'cbor',
        data: new Uint8Array(),
      } as Snapshot;
      await expect(provider.restore('', snap)).rejects.toBeInstanceOf(
        StorageError,
      );
    });
  });
});
