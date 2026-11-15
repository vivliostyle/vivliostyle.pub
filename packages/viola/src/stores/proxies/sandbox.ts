import type { BuildTask } from '@vivliostyle/cli/schema';
import { basename, extname, join } from 'pathe';
import { type INTERNAL_Op, proxy, ref, subscribe } from 'valtio';
import { deepClone, subscribeKey } from 'valtio/utils';

import type { ApiClient } from '@v/api-client';
import {
  OPFSStorageProvider,
  RemoteHttpStorageProvider,
  type StorageProvider,
} from '@v/storage-providers';
import { generateId } from '../../libs/generate-id';
import {
  categorizeAsset,
  getMimeTypeByExtension,
  type MediaAsset,
} from '../../libs/media';
import { sandboxOrigin } from '../../libs/origins';
import { SandboxFile } from '../../libs/sandbox/file';
import {
  collectFileUpdates,
  FilePersistence,
  readProjectFiles,
} from '../../libs/sandbox/persistence';
import { listSnapshotFiles } from '../../libs/sandbox/snapshot';
import {
  DEFAULT_USER_STYLESHEET_PATH,
  toConfigThemeEntries,
} from '../../libs/user-stylesheets';
import type { DeepReadonly } from '../../type-utils';
import { Cli } from './cli';
import type { ProjectId } from './project';

const defaultCss = /* css */ `:root {
  /* Edit this CSS to customize the theme */
}`;

const initialVivliostyleConfig = { entry: [] } satisfies BuildTask as BuildTask;

export const sandboxes = proxy({
  value: {} as Record<ProjectId, Sandbox>,
});

export class Sandbox {
  protected static async create({
    projectId,
    provider,
    initialize,
  }: {
    projectId: ProjectId;
    provider: StorageProvider;
    initialize: (sandbox: Sandbox) => Promise<void>;
  }) {
    const sandbox = proxy(new Sandbox({ projectId, provider }));
    const unsubscribeFiles = subscribe(sandbox.files, (ops) =>
      sandbox.handleFileUpdate(ops),
    );
    const unsubscribeConfig = subscribeKey(
      sandbox.files,
      'vivliostyle.config.json',
      async (blob) => {
        sandbox.writableVivliostyleConfig = JSON.parse(await blob.text());
      },
    );
    sandbox.unsubscribe = () => {
      unsubscribeFiles();
      unsubscribeConfig();
    };

    sandboxes.value[projectId] = sandbox;
    try {
      await initialize(sandbox);
    } catch (error) {
      await sandbox.dispose();
      throw error;
    }
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
    return Sandbox.create({
      projectId,
      provider,
      initialize: (sandbox) =>
        sandbox.initializeProjectFiles({
          themePackageName: '@vivliostyle/theme-base',
          entry: [],
        }),
    });
  }

  static async createSandboxFromFilesystem({
    projectId,
  }: {
    projectId: ProjectId;
  }) {
    const provider = await OPFSStorageProvider.open({ subPath: projectId });
    return Sandbox.create({
      projectId,
      provider,
      initialize: (sandbox) => sandbox.loadFromFileSystem(),
    });
  }

  static async createNewRemoteSandbox({
    projectId,
    api,
  }: {
    projectId: ProjectId;
    api: ApiClient;
  }) {
    const provider = new RemoteHttpStorageProvider(api, projectId);
    return Sandbox.create({
      projectId,
      provider,
      initialize: (sandbox) =>
        sandbox.initializeProjectFiles({
          themePackageName: '@vivliostyle/theme-base',
          entry: [],
        }),
    });
  }

  static async createRemoteSandboxFromApi({
    projectId,
    api,
  }: {
    projectId: ProjectId;
    api: ApiClient;
  }) {
    const provider = new RemoteHttpStorageProvider(api, projectId);
    return Sandbox.create({
      projectId,
      provider,
      initialize: async (sandbox) => {
        // An "empty" remote project (e.g. one created via the "Create an empty
        // cloud project" button) has no vivliostyle.config.json yet, so
        // `loadFromFileSystem` would throw. Seed it instead so the editor mounts.
        const entries = await provider.list('', { recursive: true });
        if (entries.length === 0) {
          await sandbox.initializeProjectFiles({
            themePackageName: '@vivliostyle/theme-base',
            entry: [],
          });
        } else {
          await sandbox.loadFromFileSystem();
        }
      },
    });
  }

  projectId: ProjectId;
  // Distinguishes successive sandboxes of one project (the draft is recreated
  // under a fixed id) so each gets a fresh iframe and CLI worker.
  instanceId = generateId();
  iframeOrigin: string;
  provider: StorageProvider;
  files: Record<string, ReturnType<typeof ref<SandboxFile>>> = proxy({});
  cli = Cli.create(this);

  protected persistence: FilePersistence;
  protected unsubscribe = () => {};
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
    provider: StorageProvider;
  }) {
    this.projectId = projectId;
    this.iframeOrigin = sandboxOrigin(`sandbox-${projectId}`);
    this.provider = ref(provider);
    this.persistence = ref(new FilePersistence(provider));
  }

  async dispose() {
    this.unsubscribe();
    this.cli.dispose();
    if (sandboxes.value[this.projectId] === this) {
      delete sandboxes.value[this.projectId];
    }
    await this.persistence.idle();
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
      const category = categorizeAsset(path);
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
      file.type || getMimeTypeByExtension(ext) || 'application/octet-stream';
    this.files[savePath] = ref(new SandboxFile(mimeType, bytes));
    return savePath;
  }

  async loadFromFileSystem() {
    const { config, files } = await readProjectFiles(this.provider);
    this.writableVivliostyleConfig = JSON.parse(
      new TextDecoder().decode(config),
    );
    for (const k in this.files) {
      delete this.files[k];
    }
    this.files['vivliostyle.config.json'] = ref(
      new SandboxFile('application/json', config),
    );
    for (const [path, bytes] of files) {
      this.files[path] = ref(new SandboxFile('', bytes));
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
      config.theme = toConfigThemeEntries(themePackageName, [
        DEFAULT_USER_STYLESHEET_PATH,
      ]);
    });
    this.files[DEFAULT_USER_STYLESHEET_PATH] = ref(
      new SandboxFile('text/css', defaultCss),
    );
  }

  async saveMemoryToFileSystem() {
    const cli = await this.cli.createRemotePromise();
    const cbor = await cli.toBinarySnapshot({ path: '/workdir' });
    // Mutate `files` synchronously so valtio batches every change into a single
    // subscriber notification; `handleFileUpdate` then persists them in one
    // request instead of one PUT per file.
    for (const { path, mimeType, data } of listSnapshotFiles(cbor)) {
      this.files[path] = ref(new SandboxFile(mimeType, data));
    }
    // Yield a macrotask so the `files` subscriber (valtio batches it onto a
    // microtask) starts the batch, then await it. Uses `setTimeout` rather
    // than `requestAnimationFrame`: rAF is paused while the tab is hidden, so
    // it would never fire — hanging this save, and thus project creation, in a
    // background tab.
    await new Promise((resolve) => setTimeout(resolve));
    await this.persistence.latest;
  }

  protected async handleFileUpdate(ops: INTERNAL_Op[]) {
    const pendingUpdates = collectFileUpdates(ops);
    // Queued before the bytes resolve, so `dispose()` waits for this batch.
    const persist = this.persistence.persist(pendingUpdates);
    const updates = await pendingUpdates;
    // Rejects once the worker is gone, leaving nothing to mirror the change into.
    const cli = await this.cli.createRemotePromise().catch(() => undefined);
    await Promise.all([cli?.fromJSON(updates, '/workdir'), persist]);
  }
}
