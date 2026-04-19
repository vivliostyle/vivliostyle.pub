import { CborDecoder } from '@jsonjoy.com/json-pack/lib/cbor';
import type { BuildTask } from '@vivliostyle/cli/schema';
import { basename, dirname, extname, join, sep } from 'pathe';
import { type INTERNAL_Op, proxy, ref, subscribe } from 'valtio';
import { deepClone, subscribeKey } from 'valtio/utils';

import type { DeepReadonly } from '../../type-utils';
import { Cli } from './cli';
import type { ProjectId } from './project';

const node = Symbol();
interface Tree<T> {
  [node]: T;
  [key: string]: Tree<T>;
}

type SnapshotNode = FolderNode | FileNode | SymlinkNode | UnknownNode;
type FolderNode = [
  type: 0,
  meta: object,
  entries: {
    [child: string]: SnapshotNode;
  },
];
type FileNode = [type: 1, meta: object, data: Uint8Array];
type SymlinkNode = [
  type: 2,
  meta: {
    target: string;
  },
];
type UnknownNode = null;

const origin = `https://${import.meta.env.VITE_APP_HOSTNAME}${location.port ? `:${location.port}` : ''}`;

const defaultCss = /* css */ `:root {
  /* Edit this CSS to customize the theme */
}`;

const initialVivliostyleConfig = { entry: [] } satisfies BuildTask as BuildTask;

export const sandboxes = proxy({
  value: {} as Record<ProjectId, Sandbox>,
});

export class SandboxFile {
  public type: string;
  public bytes: Promise<Uint8Array>;

  constructor(file: File);
  constructor(type: string, bytes: Uint8Array);
  constructor(type: string, text: string);
  constructor(
    ...args:
      | [file: File]
      | [type: string, bytes: Uint8Array]
      | [type: string, text: string]
  ) {
    if (args.length === 1) {
      this.type = args[0].type;
      this.bytes = args[0].bytes();
    } else {
      this.type = args[0];
      this.bytes =
        typeof args[1] === 'string'
          ? Promise.resolve(new TextEncoder().encode(args[1]))
          : Promise.resolve(args[1]);
    }
  }

  text() {
    return this.bytes.then((bytes) => new TextDecoder().decode(bytes));
  }

  buffer() {
    return this.bytes.then(
      (bytes) =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
    );
  }

  blob() {
    return this.buffer().then((buffer) => {
      return new Blob([buffer], { type: this.type });
    });
  }
}

export class Sandbox {
  static officialTemplates = {
    blank: {
      title: 'Blank Book Template',
      description: 'A minimal template to start from scratch.',
      source: `${origin}/_templates/minimal.tar.gz`,
    },
    basic: {
      title: 'Basic Book Template',
      description: 'A simple template with common sections for a book.',
      source: `${origin}/_templates/basic.tar.gz`,
    },
  } as const;

  protected static create({
    projectId,
    directoryHandle,
  }: {
    projectId: ProjectId;
    directoryHandle: FileSystemDirectoryHandle;
  }) {
    const sandbox = proxy(new Sandbox({ projectId, directoryHandle }));
    subscribe(sandbox.files, (ops) => sandbox.handleFileUpdate(ops));
    subscribeKey(sandbox.files, 'vivliostyle.config.json', async (blob) => {
      sandbox.writableVivliostyleConfig = JSON.parse(await blob.text());
    });

    sandboxes.value[projectId] = sandbox;
    return sandbox;
  }

  static async checkFilesystemExists({ projectId }: { projectId: ProjectId }) {
    const root = await navigator.storage.getDirectory();
    try {
      await root.getDirectoryHandle(projectId);
      return true;
    } catch {
      return false;
    }
  }

  static async createNewSandbox({ projectId }: { projectId: ProjectId }) {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(projectId, { recursive: true });
    } catch {
      // ignore
    }
    const directoryHandle = ref(
      await root.getDirectoryHandle(projectId, {
        create: true,
      }),
    );
    const sandbox = proxy(Sandbox.create({ projectId, directoryHandle }));
    await sandbox.initializeProjectFiles({
      themePackageName: '@vivliostyle/theme-base',
      entry: [],
    });
    return sandbox;
  }

  static async createSandboxFromFilesystem({
    projectId,
  }: {
    projectId: ProjectId;
  }) {
    const root = await navigator.storage.getDirectory();
    const directoryHandle = ref(
      await root.getDirectoryHandle(projectId, {
        create: true,
      }),
    );
    const sandbox = proxy(Sandbox.create({ projectId, directoryHandle }));
    await sandbox.loadFromFileSystem();
    return sandbox;
  }

  iframeOrigin: string;
  projectDirectoryHandle: FileSystemDirectoryHandle;
  files: Record<string, ReturnType<typeof ref<SandboxFile>>> = {};
  cli = Cli.create(this);

  protected writableVivliostyleConfig = deepClone(initialVivliostyleConfig);

  get vivliostyleConfig() {
    return this.writableVivliostyleConfig as DeepReadonly<
      typeof this.writableVivliostyleConfig
    >;
  }

  protected constructor({
    projectId,
    directoryHandle,
  }: {
    projectId: ProjectId;
    directoryHandle: FileSystemDirectoryHandle;
  }) {
    const url = new URL(location.href);
    url.hostname = `sandbox-${projectId}.${url.hostname}`;
    this.iframeOrigin = url.origin;
    this.projectDirectoryHandle = ref(directoryHandle);
  }

  updateVivliostyleConfig(
    callback: (_: typeof this.writableVivliostyleConfig) => void,
  ) {
    callback(this.writableVivliostyleConfig);
    this.files['vivliostyle.config.json'] = ref(
      new SandboxFile(
        'application/json',
        JSON.stringify(this.writableVivliostyleConfig, null, 2),
      ),
    );
  }

  protected async readFileSystemRecursive({
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

  protected async traverseFileDirectoryHandle({
    filename,
    create,
    dirHandleTreeCache = { [node]: this.projectDirectoryHandle },
  }: {
    filename: string;
    create: boolean;
    dirHandleTreeCache?: Tree<FileSystemDirectoryHandle>;
  }): Promise<[parent: FileSystemDirectoryHandle, basename: string]> {
    let current = dirHandleTreeCache;
    const base = basename(filename);
    for (const seg of dirname(filename).split(sep)) {
      if (seg === '' || seg === '.') {
        continue;
      }
      current[seg] ??= {
        [node]: await current[node].getDirectoryHandle(seg, { create }),
      };
      current = current[seg];
    }
    return [current[node], base];
  }

  async loadFromFileSystem() {
    const newFiles: typeof this.files = {};
    let configJson: string;
    try {
      const configFileHandle = await this.projectDirectoryHandle.getFileHandle(
        'vivliostyle.config.json',
      );
      const file = await configFileHandle.getFile();
      newFiles['vivliostyle.config.json'] = ref(new SandboxFile(file));
      configJson = await file.text();
    } catch {
      throw new Error('Project does not exist');
    }
    this.writableVivliostyleConfig = JSON.parse(configJson);

    await this.readFileSystemRecursive({
      dirHandle: this.projectDirectoryHandle,
      ignore: [/^node_modules/, /^\.vivliostyle/],
      handle: async (name, fileHandle) => {
        const file = await fileHandle.getFile();
        newFiles[name] = ref(new SandboxFile(file));
      },
    });

    for (const k in this.files) {
      delete this.files[k];
    }
    for (const k in newFiles) {
      this.files[k] = newFiles[k];
    }
  }

  async initializeProjectFiles({
    themePackageName,
    entry,
  }: {
    themePackageName: string;
    entry: BuildTask['entry'];
  }) {
    this.updateVivliostyleConfig((config) => {
      config.entry = entry;
      config.theme = [themePackageName, './style.css'];
    });
    this.files['style.css'] = ref(new SandboxFile('text/css', defaultCss));
  }

  async saveMemoryToFileSystem() {
    const cli = await this.cli.createRemotePromise();
    const cbor = await cli.toBinarySnapshot({ path: '/workdir' });
    const rootNode = new CborDecoder().decode(cbor) as SnapshotNode;

    const dirHandleTreeCache = {
      [node]: this.projectDirectoryHandle,
    };

    const traverse = async (snapshot: SnapshotNode, path = '') => {
      if (!snapshot) {
        return;
      }
      switch (snapshot[0]) {
        case 0 /* Folder */: {
          const [, , entries] = snapshot;
          for (const [name, entry] of Object.entries(entries)) {
            await traverse(entry, join(path, name));
          }
          break;
        }
        case 1 /* File */: {
          const [, , data] = snapshot;
          const buffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          const [parentDirHandle, basename] =
            await this.traverseFileDirectoryHandle({
              filename: path,
              create: true,
              dirHandleTreeCache,
            });
          const fileHandle = await parentDirHandle.getFileHandle(basename, {
            create: true,
          });
          const writable = await fileHandle.createWritable();
          await writable.write(buffer);
          await writable.close();

          // FIXME: Get proper MIME type
          const mimeType =
            {
              css: 'text/css',
              json: 'application/json',
              md: 'text/markdown',
              html: 'text/html',
            }[extname(path).slice(1)] || 'application/octet-stream';
          this.files[path] = ref(
            new SandboxFile(mimeType, new Uint8Array(buffer)),
          );
          break;
        }
      }
    };
    await traverse(rootNode);
    // Wait the subscriber callback ends
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  protected async saveToFileSystem(
    filename: string,
    content: Uint8Array<ArrayBuffer> | null,
  ) {
    const [parentDirHandle, basename] = await this.traverseFileDirectoryHandle({
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

  protected async handleFileUpdate(ops: INTERNAL_Op[]) {
    const updates: Record<string, Uint8Array | null> = {};
    for (const op of ops) {
      if (typeof op[1][0] !== 'string') {
        continue;
      }
      if (op[0] === 'set') {
        if (op[2] === op[3] || !(op[2] instanceof SandboxFile)) {
          continue;
        }
        updates[op[1][0]] = await op[2].bytes;
      }
      if (op[0] === 'delete') {
        updates[op[1][0]] = null;
      }
    }
    await Promise.all([
      (async () => {
        const cli = await this.cli.createRemotePromise();
        await cli.fromJSON(updates, '/workdir');
      })(),
      ...Object.entries(updates).map((e) =>
        this.saveToFileSystem(
          ...(e as [string, Uint8Array<ArrayBuffer> | null]),
        ),
      ),
    ]);
  }
}
