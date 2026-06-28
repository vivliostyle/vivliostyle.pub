import { beforeEach, describe, expect, it } from 'vitest';

import { StorageNotFoundError } from '../errors';
import { type RemoteFileApi, RemoteHttpStorageProvider } from './remote-http';

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

class FakeFileApi implements RemoteFileApi {
  private files = new Map<string, { data: Uint8Array; contentType: string }>();
  writeFileCalls = 0;
  writeFilesCalls = 0;
  downloadUrlFetches = 0;

  private async entry(path: string, download: boolean) {
    const file = this.files.get(path);
    if (!file) throw new Error(`missing ${path}`);
    return {
      path,
      size: file.data.byteLength,
      contentType: file.contentType,
      updatedAt: 1,
      hash: await sha256Hex(file.data),
      ...(download ? { downloadUrl: `mem://${encodeURIComponent(path)}` } : {}),
    };
  }

  async listFiles(_projectId: string, options?: { download?: boolean }) {
    return Promise.all(
      [...this.files.keys()].map((path) =>
        this.entry(path, options?.download ?? false),
      ),
    );
  }

  async readFile(_projectId: string, path: string) {
    return this.files.get(path)?.data ?? null;
  }

  async writeFile(
    _projectId: string,
    path: string,
    data: Uint8Array,
    contentType = 'application/octet-stream',
  ) {
    this.writeFileCalls++;
    this.files.set(path, { data, contentType });
  }

  async writeFiles(
    _projectId: string,
    changes: {
      writes?: { path: string; data: Uint8Array; contentType?: string }[];
      deletes?: string[];
    },
  ) {
    this.writeFilesCalls++;
    for (const write of changes.writes ?? []) {
      this.files.set(write.path, {
        data: write.data,
        contentType: write.contentType ?? 'application/octet-stream',
      });
    }
    for (const path of changes.deletes ?? []) {
      this.files.delete(path);
    }
    return Promise.all(
      (changes.writes ?? []).map((write) => this.entry(write.path, false)),
    );
  }

  async deleteFile(_projectId: string, path: string) {
    this.files.delete(path);
  }

  async fetchDownloadUrl(url: string) {
    this.downloadUrlFetches++;
    const path = decodeURIComponent(url.replace('mem://', ''));
    const file = this.files.get(path);
    if (!file) throw new Error(`missing ${path}`);
    return file.data;
  }
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('RemoteHttpStorageProvider', () => {
  let api: FakeFileApi;
  let provider: RemoteHttpStorageProvider;
  beforeEach(() => {
    api = new FakeFileApi();
    provider = new RemoteHttpStorageProvider(api, 'project-1');
  });

  it('reports remote capability', () => {
    expect(provider.capabilities.remote).toBe(true);
    expect(provider.metadata.kind).toBe('remote');
  });

  it('writes and reads a file, inferring the mime type', async () => {
    await provider.write('chapter.md', enc('# Title'));
    expect(dec(await provider.read('chapter.md'))).toBe('# Title');
    expect((await provider.stat('chapter.md'))?.mimeType).toBe('text/markdown');
  });

  it('throws StorageNotFoundError for a missing file', async () => {
    await expect(provider.read('missing.md')).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
    expect(await provider.exists('missing.md')).toBe(false);
  });

  it('lists immediate children and synthesizes directories', async () => {
    await provider.write('a.md', enc('a'));
    await provider.write('images/cover.png', enc('img'));
    await provider.write('images/inner/deep.png', enc('deep'));

    const top = await provider.list('');
    expect(top.find((e) => e.path === 'a.md')?.kind).toBe('file');
    expect(top.find((e) => e.path === 'images')?.kind).toBe('directory');
    expect(top).toHaveLength(2);

    const recursive = await provider.list('', { recursive: true });
    expect(recursive.every((e) => e.kind === 'file')).toBe(true);
    expect(recursive.map((e) => e.path).sort()).toEqual([
      'a.md',
      'images/cover.png',
      'images/inner/deep.png',
    ]);
  });

  it('removes a subtree recursively', async () => {
    await provider.write('keep.md', enc('keep'));
    await provider.write('images/a.png', enc('a'));
    await provider.write('images/b.png', enc('b'));

    await provider.remove('images', { recursive: true });
    expect(await provider.exists('images/a.png')).toBe(false);
    expect(await provider.exists('keep.md')).toBe(true);
  });

  it('snapshots and restores a project tree', async () => {
    await provider.write('a.md', enc('alpha'));
    await provider.write('nested/b.css', enc('body{}'));

    const snapshot = await provider.snapshot('');
    expect(Object.keys(snapshot.data).sort()).toEqual([
      '/a.md',
      '/nested/b.css',
    ]);

    const target = new RemoteHttpStorageProvider(new FakeFileApi(), 'p2');
    await target.restore('', snapshot);
    expect(dec(await target.read('a.md'))).toBe('alpha');
    expect(dec(await target.read('nested/b.css'))).toBe('body{}');
  });

  it('cleans the destination before restore when requested', async () => {
    await provider.write('old.md', enc('old'));
    await provider.restore(
      '',
      { format: 'memfs-json', data: { '/new.md': enc('new') } },
      { clean: true },
    );
    expect(await provider.exists('old.md')).toBe(false);
    expect(dec(await provider.read('new.md'))).toBe('new');
  });

  it('applies a batch of writes and deletes in one request', async () => {
    await provider.write('keep.md', enc('keep'));
    expect(api.writeFileCalls).toBe(1);

    await provider.applyBatch({
      writes: [
        { path: 'a.md', data: enc('alpha') },
        { path: 'nested/b.css', data: enc('body{}') },
      ],
      deletes: ['keep.md'],
    });

    expect(api.writeFilesCalls).toBe(1);
    expect(dec(await provider.read('a.md'))).toBe('alpha');
    expect((await provider.stat('a.md'))?.mimeType).toBe('text/markdown');
    expect(await provider.exists('keep.md')).toBe(false);
  });

  it('reads many files through direct-download URLs', async () => {
    await provider.write('a.md', enc('alpha'));
    await provider.write('b.md', enc('beta'));

    const bytes = await provider.readMany(['a.md', 'b.md', 'missing.md']);
    expect(dec(bytes.get('a.md') as Uint8Array)).toBe('alpha');
    expect(dec(bytes.get('b.md') as Uint8Array)).toBe('beta');
    expect(bytes.has('missing.md')).toBe(false);
    expect(api.downloadUrlFetches).toBe(2);
  });

  it('restore uploads only the files whose content changed', async () => {
    await provider.write('a.md', enc('alpha'));
    await provider.write('b.md', enc('beta'));
    const baseline = api.writeFilesCalls;

    await provider.restore('', {
      format: 'memfs-json',
      data: {
        '/a.md': enc('alpha'), // unchanged → skipped
        '/b.md': enc('BETA'), // changed → uploaded
        '/c.md': enc('gamma'), // new → uploaded
      },
    });

    expect(api.writeFilesCalls).toBe(baseline + 1);
    expect(dec(await provider.read('a.md'))).toBe('alpha');
    expect(dec(await provider.read('b.md'))).toBe('BETA');
    expect(dec(await provider.read('c.md'))).toBe('gamma');
  });

  it('makes no request when restore finds nothing changed', async () => {
    await provider.write('a.md', enc('alpha'));
    const baseline = api.writeFilesCalls;

    await provider.restore('', {
      format: 'memfs-json',
      data: { '/a.md': enc('alpha') },
    });

    expect(api.writeFilesCalls).toBe(baseline);
  });
});
