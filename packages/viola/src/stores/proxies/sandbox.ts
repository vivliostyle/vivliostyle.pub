import type { BuildTask } from '@vivliostyle/cli/schema';
import { basename, dirname, extname, join, relative, sep } from 'pathe';
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

export const defaultDraftDir = 'drafts';

const origin = `https://${import.meta.env.VITE_APP_HOSTNAME}${location.port ? `:${location.port}` : ''}`;

const defaultCss = /* css */ `:root {
  /* Edit this CSS to customize the theme */
}`;

const initialVivliostyleConfig = { entry: [] } satisfies BuildTask as BuildTask;

export const sandboxes = proxy({
  value: {} as Record<ProjectId, Sandbox>,
});

export class Sandbox {
  static officialTemplates = {
    blank: {
      title: 'Blank Book Template',
      description: 'A minimal template to start from scratch.',
      source: `${origin}/templates/minimal.tar.gz`,
    },
    basic: {
      title: 'Basic Book Template',
      description: 'A simple template with common sections for a book.',
      source: `${origin}/templates/basic.tar.gz`,
    },
  } as const;

  static create({
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

  iframeOrigin: string;
  projectDirectoryHandle: FileSystemDirectoryHandle;
  files: Record<string, ReturnType<typeof ref<Blob>>> = {};
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
      new Blob([JSON.stringify(this.writableVivliostyleConfig, null, 2)], {
        type: 'application/json',
      }),
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
      newFiles['vivliostyle.config.json'] = ref(file);
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
        newFiles[name] = ref(file);
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
    this.files['style.css'] = ref(new Blob([defaultCss], { type: 'text/css' }));
  }

  async saveMemoryToFileSystem() {
    const cli = await this.cli.createRemotePromise();
    const data = await cli.toJSON('/workdir');

    const dirHandleTreeCache = {
      [node]: this.projectDirectoryHandle,
    };

    for (const [absFilename, content] of Object.entries(data)) {
      if (content === null) {
        continue;
      }
      const filename = relative('/workdir', absFilename);
      const [parentDirHandle, basename] =
        await this.traverseFileDirectoryHandle({
          filename,
          create: true,
          dirHandleTreeCache,
        });
      const fileHandle = await parentDirHandle.getFileHandle(basename, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      const binary = new TextEncoder().encode(content);
      await writable.write(binary);
      await writable.close();

      // FIXME: Get proper MIME type
      const mimeType =
        {
          css: 'text/css',
          json: 'application/json',
          md: 'text/markdown',
          html: 'text/html',
        }[extname(filename).slice(1)] || 'application/octet-stream';
      this.files[filename] = ref(new Blob([binary], { type: mimeType }));
    }
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
