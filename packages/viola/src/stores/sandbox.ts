import type { BuildTask } from '@vivliostyle/cli/schema';
import * as Comlink from 'comlink';
import { invariant } from 'outvariant';
import { basename, dirname, join, sep } from 'pathe';
import { proxy, ref, subscribe } from 'valtio';
import { subscribeKey } from 'valtio/utils';

export type RemoteCli = Comlink.Remote<typeof import('@v/cli-bundle')>;

const cliProxy = proxy({
  awaiter: undefined as Promise<RemoteCli> | undefined,
  fulfilledValue: undefined as RemoteCli | undefined,

  get value() {
    this.awaiter ??= this.getAwaiter();
    return this.awaiter;
  },

  getAwaiter: () => {
    const cliPromise = new Promise<RemoteCli>((resolve) => {
      const loop = () => {
        if (cliProxy.fulfilledValue) {
          return resolve(cliProxy.fulfilledValue);
        }
        requestAnimationFrame(loop);
      };
      loop();
    });
    return cliPromise;
  },
});

const vivliostyleConfig = proxy({
  value: { entry: [] } satisfies BuildTask as BuildTask,
});

export const $sandbox = proxy({
  files: {} as Record<string, ReturnType<typeof ref<Blob>>>,
  projectDirectoryHandle: null as FileSystemDirectoryHandle | null,

  get cli(): Readonly<typeof cliProxy.value> {
    return cliProxy.value;
  },
  get vivliostyleConfig(): Readonly<typeof vivliostyleConfig.value> {
    return vivliostyleConfig.value;
  },

  updateVivliostyleConfig: (
    callback: (_: typeof vivliostyleConfig.value) => void,
  ) => {
    callback(vivliostyleConfig.value);
    $sandbox.files['vivliostyle.config.json'] = ref(
      new Blob([JSON.stringify(vivliostyleConfig.value, null, 2)], {
        type: 'application/json',
      }),
    );
  },
});

async function readFileSystemRecursive({
  dirHandle,
  handle,
  ignore,
}: {
  dirHandle: FileSystemDirectoryHandle;
  handle: (name: string, file: FileSystemFileHandle) => Promise<void>;
  ignore?: RegExp[];
}): Promise<void> {
  const promises: Promise<void>[] = [];
  async function traverse(
    dir: FileSystemDirectoryHandle,
    parent = '',
  ): Promise<void> {
    for await (const [name, entry] of dir.entries()) {
      const subPath = join(parent, name);
      if (ignore?.some((re) => re.test(subPath))) {
        continue;
      }
      if (entry.kind === 'file') {
        promises.push(handle(subPath, entry as FileSystemFileHandle));
      } else if (entry.kind === 'directory') {
        await traverse(entry as FileSystemDirectoryHandle, subPath);
      }
    }
  }
  await traverse(dirHandle);
  await Promise.all(promises);
}

async function traverseFileDirectoryHandle({
  dirHandle,
  filename,
  create,
}: {
  dirHandle: FileSystemDirectoryHandle;
  filename: string;
  create: boolean;
}): Promise<[parent: FileSystemDirectoryHandle, basename: string]> {
  let dir = dirHandle;
  const base = basename(filename);
  for (const seg of dirname(filename).split(sep)) {
    if (seg === '' || seg === '.') {
      continue;
    }
    dir = await dir.getDirectoryHandle(seg, { create });
  }
  return [dir, base];
}

export async function loadProjectFromCache() {
  const projectDir = $sandbox.projectDirectoryHandle;
  invariant(projectDir, 'projectDirectoryHandle is not set');

  const newFiles: (typeof $sandbox)['files'] = {};
  try {
    const configFileHandle = await projectDir.getFileHandle(
      'vivliostyle.config.json',
    );
    const file = await configFileHandle.getFile();
    newFiles['vivliostyle.config.json'] = ref(file);
  } catch {
    throw new Error('Project does not exist');
  }

  await readFileSystemRecursive({
    dirHandle: projectDir,
    ignore: [/^node_modules/, /^\.vivliostyle/],
    handle: async (name, fileHandle) => {
      const file = await fileHandle.getFile();
      newFiles[name] = ref(file);
    },
  });

  for (const k in $sandbox.files) {
    delete $sandbox.files[k];
  }
  for (const k in newFiles) {
    $sandbox.files[k] = newFiles[k];
  }
}

export function createCliWorkerResolver() {
  let cliWorker: RemoteCli | undefined;
  return {
    resolve: (value: RemoteCli) => {
      cliWorker = value;
      cliProxy.fulfilledValue = value;
    },
    reset: () => {
      cliWorker?.[Comlink.releaseProxy]();
      cliProxy.fulfilledValue = undefined;
      cliProxy.awaiter = undefined;
    },
  };
}

async function fileUpdateCallback(
  filename: string,
  content: Uint8Array | null,
) {
  if (!$sandbox.projectDirectoryHandle) {
    return;
  }
  const [parentDirHandle, basename] = await traverseFileDirectoryHandle({
    dirHandle: $sandbox.projectDirectoryHandle,
    filename,
    create: !!content,
  });
  if (content) {
    const fileHandle = await parentDirHandle.getFileHandle(basename, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } else {
    await parentDirHandle.removeEntry(basename);
  }
}

subscribe($sandbox.files, async (ops) => {
  const updates: Record<string, Uint8Array | null> = {};
  for (const op of ops) {
    if (typeof op[1][0] !== 'string') {
      continue;
    }
    if (op[0] === 'set') {
      if (op[2] === op[3] || !(op[2] instanceof Blob)) {
        continue;
      }
      updates[op[1][0]] = new Uint8Array(await op[2].arrayBuffer());
    }
    if (op[0] === 'delete') {
      updates[op[1][0]] = null;
    }
  }
  await Promise.all([
    (async () => {
      const cli = await $sandbox.cli;
      await cli.fromJSON(updates, '/workdir');
    })(),
    ...Object.entries(updates).map((e) => fileUpdateCallback(...e)),
  ]);
});

subscribeKey($sandbox.files, 'vivliostyle.config.json', async (blob) => {
  vivliostyleConfig.value = JSON.parse(await blob.text());
});
