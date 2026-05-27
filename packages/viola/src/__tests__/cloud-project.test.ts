import { beforeEach, describe, expect, it, vi } from 'vitest';

// Importing `../router` pulls in TanStack Router + the full route tree, which
// expects a DOM. Tests never hit the `currentProjectId === id` branch of
// `deleteCloudProject` where the real `router.navigate` would matter.
vi.mock('../router', () => ({
  router: { navigate: vi.fn() },
}));

// `discoverProjects` enumerates OPFS, which throws under Node.
vi.mock('../stores/actions/discover-projects', () => ({
  discoverProjects: vi.fn().mockResolvedValue(undefined),
}));

import { $projects, $session } from '../stores/accessors';
import {
  createCloudProject,
  deleteCloudProject,
} from '../stores/actions/cloud-project';
import { register } from '../stores/actions/session';
import type { ProjectId } from '../stores/proxies/project';
import { buildTestServer, type TestServer } from './harness/server';
import { setupTestSession } from './harness/session';
import { bindApp } from './setup';

describe('cloud project CRUD', () => {
  let server: TestServer;

  beforeEach(() => {
    server = buildTestServer();
    bindApp(server.root);
    setupTestSession();
    for (const key of Object.keys($projects.entries)) {
      delete $projects.entries[key as ProjectId];
    }
    $projects.currentProjectId = null;
  });

  it('rejects createCloudProject when no session is authenticated', async () => {
    await expect(
      createCloudProject({ title: 'Untitled' }),
    ).rejects.toThrowError(/Sign in to create a cloud project/);
  });

  it('creates a project, reflects it in $projects.entries, and matches server state', async () => {
    await register('alice', 'password123');

    const entry = await createCloudProject({
      title: 'My Book',
      author: 'Alice',
      language: 'en',
    });

    expect(entry.source).toBe('remote');
    expect(entry.title).toBe('My Book');
    expect($projects.entries[entry.projectId]).toMatchObject({
      projectId: entry.projectId,
      source: 'remote',
      title: 'My Book',
    });

    const remote = await $session.api.listProjects();
    expect(remote.map((r) => r.id)).toContain(entry.projectId);
  });

  it('deletes a project and removes it from $projects.entries + server', async () => {
    await register('alice', 'password123');
    const entry = await createCloudProject({ title: 'Doomed' });
    expect($projects.entries[entry.projectId]).toBeDefined();

    await deleteCloudProject(entry.projectId);
    expect($projects.entries[entry.projectId]).toBeUndefined();

    const remote = await $session.api.listProjects();
    expect(remote.map((r) => r.id)).not.toContain(entry.projectId);
  });

  it('rejects deleteCloudProject when the session is anonymous', async () => {
    await register('alice', 'password123');
    const entry = await createCloudProject({ title: 'Owned' });
    // Drop the local session without going through logout, so the action's
    // `$session.status !== 'authenticated'` guard is what fires.
    setupTestSession();
    await expect(deleteCloudProject(entry.projectId)).rejects.toThrowError(
      /Sign in to delete a cloud project/,
    );
  });

  it('isolates project visibility between two users on the same server', async () => {
    await register('alice', 'password123');
    const aliceEntry = await createCloudProject({ title: "Alice's" });

    setupTestSession();
    await register('bob', 'password123');

    const bobRemote = await $session.api.listProjects();
    expect(bobRemote.map((r) => r.id)).not.toContain(aliceEntry.projectId);

    const bobEntry = await createCloudProject({ title: "Bob's" });
    const bobRemoteAfter = await $session.api.listProjects();
    expect(bobRemoteAfter.map((r) => r.id)).toEqual([bobEntry.projectId]);
  });
});
