import { OPFSStorageProvider } from '@v/storage-providers';
import { router } from '../../router';
import { $projects, $sandboxes } from '../accessors';
import type { ProjectId } from '../proxies/project';
import { discoverProjects } from './discover-projects';

export async function deleteLocalProject(projectId: ProjectId): Promise<void> {
  if ($projects.currentProjectId === projectId) {
    await router.navigate({ to: '/' });
  }
  const root = await OPFSStorageProvider.open();
  try {
    await root.remove(projectId, { recursive: true });
  } catch {
    // already gone
  }
  delete $projects.entries[projectId];
  delete $projects.value[projectId];
  delete $sandboxes.value[projectId];
  if ($projects.currentProjectId === projectId) {
    $projects.currentProjectId = null;
  }
  await discoverProjects();
}
