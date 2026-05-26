import { $projects, $session } from '../accessors';
import { Project, type ProjectId } from '../proxies/project';
import { Sandbox } from '../proxies/sandbox';
import { discoverProjects } from './discover-projects';
import { sessionReady } from './session';

export async function openProject(projectId: ProjectId): Promise<Project> {
  let project = $projects.value[projectId];
  if (!project) {
    await sessionReady;
    if (!(projectId in $projects.entries)) {
      await discoverProjects();
    }
    const entry = $projects.entries[projectId];
    if (!entry) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const sandboxPromise =
      entry.source === 'remote'
        ? Sandbox.createRemoteSandboxFromApi({ projectId, api: $session.api })
        : Sandbox.createSandboxFromFilesystem({ projectId });
    project = Project.createProjectFromSandbox({ projectId, sandboxPromise });
  }
  await project.setupPromise;
  $projects.currentProjectId = projectId;
  return project;
}
