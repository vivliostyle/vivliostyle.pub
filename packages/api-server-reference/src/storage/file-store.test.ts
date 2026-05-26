import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileStore } from './file-store';

const PROJECT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PROJECT_ID_2 = '11111111-2222-3333-4444-555555555555';
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

// Run the same behavioral contract against both backends.
const backends: Array<{
  name: string;
  setup: () => Promise<{ store: FileStore; teardown: () => void }>;
}> = [
  {
    name: 'in-memory (vfs)',
    async setup() {
      return { store: new FileStore(), teardown: () => {} };
    },
  },
  {
    name: 'on-disk (node:fs)',
    async setup() {
      const dir = mkdtempSync(join(tmpdir(), 'file-store-'));
      return {
        store: new FileStore({ basePath: dir }),
        teardown: () => rmSync(dir, { recursive: true, force: true }),
      };
    },
  },
];

for (const backend of backends) {
  describe(`FileStore ${backend.name}`, () => {
    let store: FileStore;
    let teardown: () => void;

    beforeEach(async () => {
      const ctx = await backend.setup();
      store = ctx.store;
      teardown = ctx.teardown;
    });
    afterEach(() => teardown());

    it('writes, reads and stats a file with derived mime type', async () => {
      const entry = await store.writeFile(PROJECT_ID, 'chapter.md', enc('# T'));
      expect(entry.path).toBe('chapter.md');
      expect(entry.size).toBe(3);
      expect(entry.contentType).toBe('text/markdown');

      const file = await store.readFile(PROJECT_ID, 'chapter.md');
      if (!file) throw new Error('missing');
      expect(dec(file.data)).toBe('# T');
      expect(file.contentType).toBe('text/markdown');
    });

    it('returns undefined for a missing file', async () => {
      expect(await store.readFile(PROJECT_ID, 'missing.md')).toBeUndefined();
    });

    it('overwrites an existing file', async () => {
      await store.writeFile(PROJECT_ID, 'a.md', enc('one'));
      await store.writeFile(PROJECT_ID, 'a.md', enc('two'));
      const file = await store.readFile(PROJECT_ID, 'a.md');
      expect(dec(file?.data ?? new Uint8Array())).toBe('two');
    });

    it('creates parent directories on write', async () => {
      await store.writeFile(PROJECT_ID, 'a/b/c.txt', enc('deep'));
      const file = await store.readFile(PROJECT_ID, 'a/b/c.txt');
      expect(dec(file?.data ?? new Uint8Array())).toBe('deep');
    });

    it('lists files recursively and sorted', async () => {
      await store.writeFile(PROJECT_ID, 'z.md', enc('z'));
      await store.writeFile(PROJECT_ID, 'a.md', enc('a'));
      await store.writeFile(PROJECT_ID, 'images/cover.png', enc('img'));

      const list = await store.listFiles(PROJECT_ID);
      expect(list.map((e) => e.path)).toEqual([
        'a.md',
        'images/cover.png',
        'z.md',
      ]);
      expect(list[1].contentType).toBe('image/png');
    });

    it('returns an empty list for a project with no files', async () => {
      expect(await store.listFiles(PROJECT_ID)).toEqual([]);
    });

    it('removes a single file', async () => {
      await store.writeFile(PROJECT_ID, 'a.md', enc('a'));
      expect(await store.removeFile(PROJECT_ID, 'a.md')).toBe(true);
      expect(await store.removeFile(PROJECT_ID, 'a.md')).toBe(false);
      expect(await store.readFile(PROJECT_ID, 'a.md')).toBeUndefined();
    });

    it('removes an entire project tree, including attachments', async () => {
      await store.writeFile(PROJECT_ID, 'a.md', enc('a'));
      await store.writeFile(PROJECT_ID, 'sub/b.md', enc('b'));
      const sha = 'a'.repeat(64);
      await store.writeAttachment(PROJECT_ID, sha, enc('att'));
      await store.writeFile(PROJECT_ID_2, 'keep.md', enc('k'));

      await store.removeProject(PROJECT_ID);
      expect(await store.listFiles(PROJECT_ID)).toEqual([]);
      expect(await store.readAttachment(PROJECT_ID, sha)).toBeUndefined();
      // Sibling projects are untouched.
      const survivor = await store.readFile(PROJECT_ID_2, 'keep.md');
      expect(dec(survivor?.data ?? new Uint8Array())).toBe('k');
    });

    it('round-trips a content-addressed attachment', async () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i += 1) data[i] = i;
      const sha = 'b'.repeat(64);
      await store.writeAttachment(PROJECT_ID, sha, data);
      const back = await store.readAttachment(PROJECT_ID, sha);
      if (!back) throw new Error('missing');
      expect(back.byteLength).toBe(256);
      expect(Array.from(back)).toEqual(Array.from(data));
    });

    it('returns undefined for a missing or malformed attachment hash', async () => {
      expect(
        await store.readAttachment(PROJECT_ID, 'c'.repeat(64)),
      ).toBeUndefined();
      expect(
        await store.readAttachment(PROJECT_ID, 'not-a-hash'),
      ).toBeUndefined();
    });

    it('rejects path traversal in file paths', async () => {
      await expect(
        store.writeFile(PROJECT_ID, '../escape.md', enc('x')),
      ).rejects.toThrow(/Invalid file path/);
      await expect(
        store.readFile(PROJECT_ID, 'a/../../escape.md'),
      ).rejects.toThrow(/Invalid file path/);
    });

    it('rejects invalid project ids', async () => {
      await expect(
        store.writeFile('../oops', 'a.md', enc('x')),
      ).rejects.toThrow(/Invalid project id/);
    });
  });
}

describe('FileStore on-disk persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'file-store-fs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes file contents under <basePath>/<projectId>/files', async () => {
    const store = new FileStore({ basePath: dir });
    await store.writeFile(PROJECT_ID, 'chapter.md', enc('hello'));
    const onDisk = join(dir, PROJECT_ID, 'files', 'chapter.md');
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk, 'utf8')).toBe('hello');
  });

  it('persists data across reopens', async () => {
    const first = new FileStore({ basePath: dir });
    await first.writeFile(PROJECT_ID, 'chapter.md', enc('hello'));

    const second = new FileStore({ basePath: dir });
    const file = await second.readFile(PROJECT_ID, 'chapter.md');
    expect(dec(file?.data ?? new Uint8Array())).toBe('hello');
  });

  it('discovers externally created files in listFiles', async () => {
    const store = new FileStore({ basePath: dir });
    const filesDir = join(dir, PROJECT_ID, 'files', 'subdir');
    rmSync(filesDir, { recursive: true, force: true });
    // Simulate a user dropping a file into the directory out-of-band.
    await store.writeFile(PROJECT_ID, 'placeholder', enc(''));
    writeFileSync(join(dir, PROJECT_ID, 'files', 'external.txt'), 'ext');

    const list = await store.listFiles(PROJECT_ID);
    expect(list.map((e) => e.path).sort()).toEqual([
      'external.txt',
      'placeholder',
    ]);
  });
});
