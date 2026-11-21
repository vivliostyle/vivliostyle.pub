import { OPFSStorageProvider } from '@v/storage-providers';
import { router } from '../../router';
import { $projects, $sandboxes } from '../accessors';
import type { ProjectId } from '../proxies/project';
import { discoverProjects } from './discover-projects';

export async function deleteLocalProject(projectId: ProjectId): Promise<void> {
  if ($projects.currentProjectId === projectId) {
    await router.navigate({ to: '/' });
  }
  // A project still being created has its sandbox but no Project yet.
  await ($projects.value[projectId] ?? $sandboxes.value[projectId])?.dispose();
  const root = await OPFSStorageProvider.open();
  try {
    await root.remove(projectId, { recursive: true });
  } catch {
    // already gone
  }
  delete $projects.entries[projectId];
  if ($projects.currentProjectId === projectId) {
    $projects.currentProjectId = null;
  }
  await discoverProjects();
}
