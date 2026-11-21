import type { INTERNAL_Op } from 'valtio';

import type { BatchWrite, StorageProvider } from '@v/storage-providers';
import { SandboxFile } from './file';

// Final contents per path after a batch of `files` ops; `null` is a deletion.
export type FileUpdates = Record<string, Uint8Array | null>;

export async function collectFileUpdates(
  ops: readonly INTERNAL_Op[],
): Promise<FileUpdates> {
  const updates: FileUpdates = {};
  for (const op of ops) {
    const path = op[1][0];
    if (typeof path !== 'string') {
      continue;
    }
    if (op[0] === 'set') {
      if (op[2] === op[3] || !(op[2] instanceof SandboxFile)) {
        continue;
      }
      updates[path] = await op[2].bytes;
    }
    if (op[0] === 'delete') {
      updates[path] = null;
    }
  }
  return updates;
}

export function splitFileUpdates(updates: FileUpdates): {
  writes: BatchWrite[];
  deletes: string[];
} {
  const writes: BatchWrite[] = [];
  const deletes: string[] = [];
  for (const [path, data] of Object.entries(updates)) {
    if (data) writes.push({ path, data });
    else deletes.push(path);
  }
  return { writes, deletes };
}

export async function readProjectFiles(provider: StorageProvider): Promise<{
  config: Uint8Array;
  files: Map<string, Uint8Array>;
}> {
  let config: Uint8Array;
  try {
    config = await provider.read('vivliostyle.config.json');
  } catch {
    throw new Error('Project does not exist');
  }
  const entries = await provider.list('', {
    recursive: true,
    ignore: [/^node_modules/, /^\.vivliostyle/],
  });
  const paths = entries
    .filter(
      (entry) =>
        entry.kind === 'file' && entry.path !== 'vivliostyle.config.json',
    )
    .map((entry) => entry.path);
  // Pull all files in one shot when the provider can (remote: direct from the
  // blob store, bypassing the API), falling back to per-file reads otherwise.
  const bytesByPath = provider.readMany
    ? await provider.readMany(paths)
    : new Map(
        await Promise.all(
          paths.map(async (path) => [path, await provider.read(path)] as const),
        ),
      );
  const files = new Map<string, Uint8Array>();
  for (const path of paths) {
    const bytes = bytesByPath.get(path);
    if (bytes) {
      files.set(path, bytes);
    }
  }
  return { config, files };
}

export class FilePersistence {
  // The most recent batch, so a bulk operation can await the writes its
  // mutations kicked off (see `Sandbox.saveMemoryToFileSystem`).
  latest: Promise<void> = Promise.resolve();

  // Serializes overlapping batches: OPFS write streams take an exclusive
  // per-file lock in Chromium, and two in-flight writes to the same path
  // throw NoModificationAllowedError, silently dropping one of them.
  protected queue: Promise<void> = Promise.resolve();

  constructor(protected readonly provider: StorageProvider) {}

  persist(updates: FileUpdates): Promise<void> {
    const { writes, deletes } = splitFileUpdates(updates);
    if (writes.length === 0 && deletes.length === 0) {
      this.latest = Promise.resolve();
      return this.latest;
    }
    const run = this.queue.then(() => this.apply(writes, deletes));
    this.queue = run.catch(() => {});
    this.latest = run;
    return run;
  }

  idle(): Promise<void> {
    return this.queue;
  }

  // Collapses the per-file round-trips into a single request on providers
  // that support batching.
  protected async apply(writes: BatchWrite[], deletes: string[]) {
    if (this.provider.applyBatch) {
      await this.provider.applyBatch({ writes, deletes });
      return;
    }
    await Promise.all([
      ...writes.map(({ path, data }) => this.provider.write(path, data)),
      ...deletes.map((path) =>
        this.provider.remove(path).catch(() => {
          // already gone
        }),
      ),
    ]);
  }
}
