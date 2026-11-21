import { ref } from 'valtio';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../router', () => ({
  router: { navigate: vi.fn() },
}));

vi.mock('../stores/actions/discover-projects', () => ({
  discoverProjects: vi.fn().mockResolvedValue(undefined),
}));

// Theme installation fetches from the npm registry; fail fast instead.
vi.mock('@v/theme-registry', () => ({
  buildTreeFromRegistry: vi.fn().mockRejectedValue(new Error('offline')),
  fetchPackageContent: vi.fn(),
  bundleCss: vi.fn(),
}));

// OPFS does not exist under Node. Drafts only need a directory-scoped
// key/value store, keyed by `<subPath>/<path>`.
const opfs = new Map<string, Uint8Array>();
vi.mock('@v/storage-providers', async (importOriginal) => {
  class MemoryOPFSStorageProvider {
    constructor(private readonly base: string) {}
    static async open({ subPath = '' }: { subPath?: string } = {}) {
      return new MemoryOPFSStorageProvider(subPath);
    }
    private resolve(path: string) {
      return [this.base, path].filter(Boolean).join('/');
    }
    async read(path: string) {
      const data = opfs.get(this.resolve(path));
      if (!data) {
        throw new Error(`Not found: ${path}`);
      }
      return data;
    }
    async write(path: string, data: Uint8Array) {
      opfs.set(this.resolve(path), data);
    }
    async remove(path: string) {
      const target = this.resolve(path);
      for (const key of [...opfs.keys()]) {
        if (key === target || key.startsWith(`${target}/`)) {
          opfs.delete(key);
        }
      }
    }
    async list() {
      return [];
    }
  }
  return {
    ...(await importOriginal<typeof import('@v/storage-providers')>()),
    OPFSStorageProvider: MemoryOPFSStorageProvider,
  };
});

import { $projects, $sandboxes } from '../stores/accessors';
import { createCloudProject } from '../stores/actions/cloud-project';
import { openProject } from '../stores/actions/open-project';
import { register } from '../stores/actions/session';
import {
  draftProjectId,
  Project,
  type ProjectId,
} from '../stores/proxies/project';
import { SandboxFile } from '../stores/proxies/sandbox';
import { buildTestServer } from './harness/server';
import { setupTestSession } from './harness/session';
import { bindApp } from './setup';

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('project disposal', () => {
  beforeEach(async () => {
    bindApp(buildTestServer().root);
    setupTestSession();
    await Promise.all(
      Object.values($projects.value).map((project) => project.dispose()),
    );
    for (const key of Object.keys($projects.entries)) {
      delete $projects.entries[key as ProjectId];
    }
    $projects.currentProjectId = null;
    opfs.clear();
  });

  it('unregisters the project and its sandbox and stops syncing changes', async () => {
    await register('alice', 'password123');
    const entry = await createCloudProject({ title: 'Disposable' });
    const project = await openProject(entry.projectId);
    const sandbox = project.sandbox;
    if (!sandbox) {
      throw new Error('sandbox is not ready');
    }
    expect($sandboxes.value[entry.projectId]).toBe(sandbox);

    await project.dispose();

    expect($projects.value[entry.projectId]).toBeUndefined();
    expect($sandboxes.value[entry.projectId]).toBeUndefined();
    await expect(sandbox.cli.createRemotePromise()).rejects.toThrowError(
      /disposed/,
    );

    project.bibliography.title = 'Edited after disposal';
    await settle();
    expect(sandbox.vivliostyleConfig.title).toBeUndefined();
  });

  it('disposes the previous draft when a new one is created', async () => {
    const first = Project.createDraftProject();
    await first.setupPromise;
    const firstSandbox = first.sandbox;
    if (!firstSandbox) {
      throw new Error('sandbox is not ready');
    }

    const second = Project.createDraftProject();
    await second.setupPromise;

    expect($projects.value[draftProjectId]).toBe(second);
    expect($sandboxes.value[draftProjectId]).toBe(second.sandbox);
    expect(second.sandbox?.instanceId).not.toBe(firstSandbox.instanceId);
    await expect(firstSandbox.cli.createRemotePromise()).rejects.toThrowError(
      /disposed/,
    );

    firstSandbox.files['stale.md'] = ref(
      new SandboxFile('text/markdown', 'stale'),
    );
    await settle();
    expect(opfs.has('draft/stale.md')).toBe(false);
  });

  it('discards the draft so that the next one starts from scratch', async () => {
    const first = Project.createDraftProject();
    await first.setupPromise;
    first.bibliography.title = 'Leftover';

    void Project.disposeDraftProject();
    expect($projects.value[draftProjectId]).toBeUndefined();

    const second = Project.createDraftProject();
    await second.setupPromise;

    expect($projects.value[draftProjectId]).toBe(second);
    expect($sandboxes.value[draftProjectId]).toBe(second.sandbox);
    expect(second.bibliography.title).toBe('');
  });

  it('drops a project whose setup failed so that a retry starts over', async () => {
    await register('alice', 'password123');
    const projectId = 'missingproject' as ProjectId;
    $projects.entries[projectId] = { projectId, source: 'remote' };

    await expect(openProject(projectId)).rejects.toThrow();

    expect($projects.value[projectId]).toBeUndefined();
    expect($sandboxes.value[projectId]).toBeUndefined();
  });
});
