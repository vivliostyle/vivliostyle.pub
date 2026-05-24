import { beforeEach, describe, expect, it } from 'vitest';

import { StorageNotFoundError } from '../errors';
import { type RemoteFileApi, RemoteHttpStorageProvider } from './remote-http';

class FakeFileApi implements RemoteFileApi {
  private files = new Map<string, { data: Uint8Array; contentType: string }>();

  async listFiles(_projectId: string) {
    return [...this.files.entries()].map(([path, file]) => ({
      path,
      size: file.data.byteLength,
      contentType: file.contentType,
      updatedAt: 1,
    }));
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
    this.files.set(path, { data, contentType });
  }

  async deleteFile(_projectId: string, path: string) {
    this.files.delete(path);
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
});
