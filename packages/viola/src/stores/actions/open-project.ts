import { $projects } from '../accessors';
import { Project, type ProjectId } from '../proxies/project';
import { Sandbox } from '../proxies/sandbox';
import { discoverProjects } from './discover-projects';

const LAST_OPENED_KEY = '@v/viola/lastOpenedProjectId';

export function getLastOpenedProjectId(): ProjectId | null {
  try {
    const value = localStorage.getItem(LAST_OPENED_KEY);
    return value ? (value as ProjectId) : null;
  } catch {
    return null;
  }
}

export function rememberLastOpenedProjectId(projectId: ProjectId): void {
  try {
    localStorage.setItem(LAST_OPENED_KEY, projectId);
  } catch {
    // localStorage may be unavailable (e.g., privacy mode); skip silently.
  }
}

export async function openProject(projectId: ProjectId): Promise<Project> {
  let project = $projects.value[projectId];
  if (!project) {
    if (!(projectId in $projects.entries)) {
      await discoverProjects();
    }
    if (!(projectId in $projects.entries)) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const sandboxPromise = Sandbox.createSandboxFromFilesystem({ projectId });
    project = Project.createProjectFromSandbox({ projectId, sandboxPromise });
  }
  await project.setupPromise;
  $projects.currentProjectId = projectId;
  rememberLastOpenedProjectId(projectId);
  return project;
}
