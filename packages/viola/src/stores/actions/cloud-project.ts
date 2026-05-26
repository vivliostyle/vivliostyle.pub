import { router } from '../../router';
import { $projects, $sandboxes, $session } from '../accessors';
import type { ProjectEntry, ProjectId } from '../proxies/project';
import { discoverProjects } from './discover-projects';

export async function createCloudProject(input: {
  title?: string;
  author?: string;
  language?: string;
}): Promise<ProjectEntry> {
  if ($session.status !== 'authenticated') {
    throw new Error('Sign in to create a cloud project.');
  }
  const record = await $session.api.createProject(input);
  const entry: ProjectEntry = {
    projectId: record.id as ProjectId,
    source: 'remote',
    title: record.title,
    author: record.author,
    updatedAt: record.updatedAt,
  };
  $projects.entries[entry.projectId] = entry;
  return entry;
}

export async function deleteCloudProject(projectId: ProjectId): Promise<void> {
  if ($session.status !== 'authenticated') {
    throw new Error('Sign in to delete a cloud project.');
  }
  if ($projects.currentProjectId === projectId) {
    await router.navigate({ to: '/' });
  }
  await $session.api.deleteProject(projectId);
  delete $projects.entries[projectId];
  delete $projects.value[projectId];
  delete $sandboxes.value[projectId];
  if ($projects.currentProjectId === projectId) {
    $projects.currentProjectId = null;
  }
  await discoverProjects();
}
