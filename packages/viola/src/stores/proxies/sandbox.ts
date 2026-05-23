import { CborDecoder } from '@jsonjoy.com/json-pack/lib/cbor';
import type { BuildTask } from '@vivliostyle/cli/schema';
import { basename, extname, join } from 'pathe';
import {
  type INTERNAL_Op,
  proxy,
  ref,
  subscribe,
  unstable_enableOp,
} from 'valtio';
import { deepClone, subscribeKey } from 'valtio/utils';

import { OPFSStorageProvider } from '@v/storage-providers';
import { generateId } from '../../libs/generate-id';
import type { DeepReadonly } from '../../type-utils';
import { Cli } from './cli';
import type { ProjectId } from './project';

// valtio 2.2+ requires opting into op delivery for `subscribe` callbacks.
// `handleFileUpdate` below relies on the ops list to propagate file changes
// to the OPFS storage provider and the CLI worker's memfs, so enable it.
unstable_enableOp();

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

export type MediaCategory = 'image' | 'font' | 'audio' | 'video';

export interface MediaAsset {
  path: string;
  filename: string;
  category: MediaCategory;
  mimeType: string;
}

const MEDIA_EXTENSIONS: Record<MediaCategory, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  font: ['woff', 'woff2', 'ttf', 'otf'],
  audio: ['mp3', 'ogg', 'wav', 'm4a'],
  video: ['mp4', 'webm', 'mov'],
};

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

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
    provider,
  }: {
    projectId: ProjectId;
    provider: OPFSStorageProvider;
  }) {
    const sandbox = proxy(new Sandbox({ projectId, provider }));
    subscribe(sandbox.files, (ops) => sandbox.handleFileUpdate(ops));
    subscribeKey(sandbox.files, 'vivliostyle.config.json', async (blob) => {
      sandbox.writableVivliostyleConfig = JSON.parse(await blob.text());
    });

    sandboxes.value[projectId] = sandbox;
    return sandbox;
  }

  static async checkFilesystemExists({ projectId }: { projectId: ProjectId }) {
    try {
      await OPFSStorageProvider.open({ subPath: projectId, create: false });
      return true;
    } catch {
      return false;
    }
  }

  static async createNewSandbox({ projectId }: { projectId: ProjectId }) {
    const root = await OPFSStorageProvider.open();
    try {
      await root.remove(projectId, { recursive: true });
    } catch {
      // ignore
    }
    const provider = await OPFSStorageProvider.open({ subPath: projectId });
    const sandbox = proxy(Sandbox.create({ projectId, provider }));
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
    const provider = await OPFSStorageProvider.open({ subPath: projectId });
    const sandbox = proxy(Sandbox.create({ projectId, provider }));
    await sandbox.loadFromFileSystem();
    return sandbox;
  }

  static categorizeAsset(path: string): MediaCategory | null {
    const ext = extname(path).slice(1).toLowerCase();
    if (!ext) return null;
    for (const [category, exts] of Object.entries(MEDIA_EXTENSIONS) as [
      MediaCategory,
      readonly string[],
    ][]) {
      if (exts.includes(ext)) return category;
    }
    return null;
  }

  static getMediaAccept(category: MediaCategory): string {
    return MEDIA_EXTENSIONS[category].map((ext) => `.${ext}`).join(',');
  }

  static getMimeTypeByExtension(ext: string): string | undefined {
    return MIME_BY_EXT[ext.toLowerCase()];
  }

  iframeOrigin: string;
  provider: OPFSStorageProvider;
  files: Record<string, ReturnType<typeof ref<SandboxFile>>> = proxy({});
  cli = Cli.create(this);

  protected writableVivliostyleConfig = deepClone(initialVivliostyleConfig);

  get vivliostyleConfig() {
    return this.writableVivliostyleConfig as DeepReadonly<
      typeof this.writableVivliostyleConfig
    >;
  }

  protected constructor({
    projectId,
    provider,
  }: {
    projectId: ProjectId;
    provider: OPFSStorageProvider;
  }) {
    const url = new URL(location.href);
    url.hostname = `sandbox-${projectId}.${url.hostname}`;
    this.iframeOrigin = url.origin;
    this.provider = ref(provider);
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

  get mediaAssets(): MediaAsset[] {
    const assets: MediaAsset[] = [];
    for (const path of Object.keys(this.files)) {
      const category = Sandbox.categorizeAsset(path);
      if (!category) continue;
      const file = this.files[path];
      assets.push({
        path,
        filename: basename(path),
        category,
        mimeType: file.type,
      });
    }
    assets.sort((a, b) => a.path.localeCompare(b.path));
    return assets;
  }

  async saveMediaAsset(file: File): Promise<string> {
    const entryContext = this.vivliostyleConfig.entryContext || '';
    const ext = extname(file.name).replace(/^\./, '').toLowerCase() || 'bin';
    const id = generateId();
    const savePath = join(entryContext, 'assets', `${id}.${ext}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType =
      file.type ||
      Sandbox.getMimeTypeByExtension(ext) ||
      'application/octet-stream';
    this.files[savePath] = ref(new SandboxFile(mimeType, bytes));
    return savePath;
  }

  async loadFromFileSystem() {
    const newFiles: typeof this.files = {};
    let configBytes: Uint8Array;
    try {
      configBytes = await this.provider.read('vivliostyle.config.json');
    } catch {
      throw new Error('Project does not exist');
    }
    newFiles['vivliostyle.config.json'] = ref(
      new SandboxFile('application/json', configBytes),
    );
    this.writableVivliostyleConfig = JSON.parse(
      new TextDecoder().decode(configBytes),
    );

    const entries = await this.provider.list('', {
      recursive: true,
      ignore: [/^node_modules/, /^\.vivliostyle/],
    });
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.kind !== 'file') return;
        if (entry.path === 'vivliostyle.config.json') return;
        const bytes = await this.provider.read(entry.path);
        newFiles[entry.path] = ref(new SandboxFile('', bytes));
      }),
    );

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

    const traverse = async (snapshot: SnapshotNode, path = '') => {
      if (!snapshot) {
        return;
      }
      switch (snapshot[0]) {
        case 0 /* Folder */:
          {
            const [, , entries] = snapshot;
            for (const [name, entry] of Object.entries(entries)) {
              await traverse(entry, join(path, name));
            }
            break;
          }
        case 1 /* File */:
          {
            const [, , data] = snapshot;
            await this.provider.write(path, data);
            // FIXME: Get proper MIME type
            const mimeType =
              {
                css: 'text/css',
                json: 'application/json',
                md: 'text/markdown',
                html: 'text/html',
              }[extname(path).slice(1)] || 'application/octet-stream';
            this.files[path] = ref(new SandboxFile(mimeType, data));
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
    content: Uint8Array | null,
  ) {
    if (content) {
      await this.provider.write(filename, content);
    } else {
      try {
        await this.provider.remove(filename);
      } catch {
        // ignore missing entries (matches prior best-effort delete behavior)
      }
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
      ...Object.entries(updates).map(([path, content]) =>
        this.saveToFileSystem(path, content),
      ),
    ]);
  }
}
