import type { INTERNAL_Op } from 'valtio';
import { describe, expect, it, vi } from 'vitest';

import type { StorageProvider } from '@v/storage-providers';
import { SandboxFile } from './file';
import {
  collectFileUpdates,
  FilePersistence,
  type FileUpdates,
  readProjectFiles,
  splitFileUpdates,
} from './persistence';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | null | undefined) =>
  data ? new TextDecoder().decode(data) : data;

function createProvider(
  overrides: Partial<StorageProvider> = {},
): StorageProvider {
  return {
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as StorageProvider;
}

describe('collectFileUpdates', () => {
  it('keeps the last content per path and marks deletions as null', async () => {
    const first = new SandboxFile('text/markdown', 'first');
    const second = new SandboxFile('text/markdown', 'second');
    const ops: INTERNAL_Op[] = [
      ['set', ['a.md'], first, undefined],
      ['set', ['a.md'], second, first],
      ['delete', ['b.md'], new SandboxFile('text/markdown', 'gone')],
    ];

    const updates = await collectFileUpdates(ops);

    expect(text(updates['a.md'])).toBe('second');
    expect(updates['b.md']).toBeNull();
  });

  it('ignores no-op sets, non-file values and nested paths', async () => {
    const file = new SandboxFile('text/css', '');
    const ops: INTERNAL_Op[] = [
      ['set', ['same.css'], file, file],
      ['set', ['plain.txt'], 'not a SandboxFile', undefined],
      ['set', [Symbol('meta')], file, undefined],
    ];

    expect(await collectFileUpdates(ops)).toEqual({});
  });
});

describe('splitFileUpdates', () => {
  it('separates writes from deletions', () => {
    const { writes, deletes } = splitFileUpdates({
      'a.md': bytes('a'),
      'b.md': null,
    });

    expect(writes.map(({ path }) => path)).toEqual(['a.md']);
    expect(deletes).toEqual(['b.md']);
  });
});

describe('FilePersistence', () => {
  it('sends a whole batch through applyBatch when the provider has it', async () => {
    const applyBatch = vi.fn().mockResolvedValue(undefined);
    const provider = createProvider({ applyBatch });

    await new FilePersistence(provider).persist({
      'a.md': bytes('a'),
      'b.md': null,
    });

    expect(applyBatch).toHaveBeenCalledOnce();
    expect(applyBatch.mock.calls[0][0].deletes).toEqual(['b.md']);
    expect(provider.write).not.toHaveBeenCalled();
  });

  it('falls back to per-file writes and tolerates missing deletions', async () => {
    const provider = createProvider({
      remove: vi.fn().mockRejectedValue(new Error('missing')),
    });

    await new FilePersistence(provider).persist({
      'a.md': bytes('a'),
      'b.md': null,
    });

    expect(provider.write).toHaveBeenCalledWith('a.md', bytes('a'));
    expect(provider.remove).toHaveBeenCalledWith('b.md');
  });

  it('runs batches one at a time, even after a failed one', async () => {
    const events: string[] = [];
    let releaseFirst = () => {};
    const provider = createProvider({
      write: vi.fn(async (path: string) => {
        events.push(`start ${path}`);
        if (path === 'first.md') {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          events.push(`fail ${path}`);
          throw new Error('quota');
        }
        events.push(`end ${path}`);
      }),
    });
    const persistence = new FilePersistence(provider);

    const first = persistence.persist({ 'first.md': bytes('1') });
    const second = persistence.persist({ 'second.md': bytes('2') });
    await vi.waitFor(() => expect(events).toEqual(['start first.md']));
    releaseFirst();

    await expect(first).rejects.toThrowError('quota');
    await second;
    await expect(persistence.idle()).resolves.toBeUndefined();
    expect(events).toEqual([
      'start first.md',
      'fail first.md',
      'start second.md',
      'end second.md',
    ]);
  });

  it('queues a batch on arrival, before its updates resolve', async () => {
    const provider = createProvider();
    const persistence = new FilePersistence(provider);
    const first = Promise.withResolvers<FileUpdates>();

    persistence.persist(first.promise);
    persistence.persist({ 'a.md': bytes('second') });
    const idle = persistence.idle();
    first.resolve({ 'a.md': bytes('first') });
    await idle;

    expect(vi.mocked(provider.write).mock.calls).toEqual([
      ['a.md', bytes('first')],
      ['a.md', bytes('second')],
    ]);
  });

  it('exposes the most recent batch as `latest`', async () => {
    const provider = createProvider({
      write: vi.fn().mockRejectedValue(new Error('offline')),
    });
    const persistence = new FilePersistence(provider);

    persistence.persist({ 'a.md': bytes('a') }).catch(() => {});

    await expect(persistence.latest).rejects.toThrowError('offline');
    persistence.persist({});
    await expect(persistence.latest).resolves.toBeUndefined();
  });
});

describe('readProjectFiles', () => {
  it('reads the config and every other file, skipping tool directories', async () => {
    const stored: Record<string, string> = {
      'vivliostyle.config.json': '{"entry":[]}',
      'manuscript/a.md': '# A',
    };
    const list = vi.fn().mockResolvedValue([
      { path: 'vivliostyle.config.json', kind: 'file' },
      { path: 'manuscript', kind: 'directory' },
      { path: 'manuscript/a.md', kind: 'file' },
    ]);
    const provider = createProvider({
      read: vi.fn(async (path: string) => bytes(stored[path])),
      list,
    });

    const { config, files } = await readProjectFiles(provider);

    expect(text(config)).toBe('{"entry":[]}');
    expect([...files.keys()]).toEqual(['manuscript/a.md']);
    expect(list.mock.calls[0][1].ignore).toEqual([
      /^node_modules/,
      /^\.vivliostyle/,
    ]);
  });

  it('prefers readMany when the provider offers it', async () => {
    const readMany = vi
      .fn()
      .mockResolvedValue(new Map([['a.md', bytes('# A')]]));
    const provider = createProvider({
      read: vi.fn().mockResolvedValue(bytes('{}')),
      list: vi.fn().mockResolvedValue([
        { path: 'a.md', kind: 'file' },
        { path: 'missing.md', kind: 'file' },
      ]),
      readMany,
    });

    const { files } = await readProjectFiles(provider);

    expect(readMany).toHaveBeenCalledWith(['a.md', 'missing.md']);
    expect([...files.keys()]).toEqual(['a.md']);
    expect(provider.read).toHaveBeenCalledOnce();
  });

  it('reports a missing config as a missing project', async () => {
    const provider = createProvider({
      read: vi.fn().mockRejectedValue(new Error('NotFoundError')),
    });

    await expect(readProjectFiles(provider)).rejects.toThrowError(
      'Project does not exist',
    );
  });
});
