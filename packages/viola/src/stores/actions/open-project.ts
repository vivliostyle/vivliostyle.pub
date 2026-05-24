import { $projects } from '../accessors';
import { Project, type ProjectId } from '../proxies/project';
import { Sandbox } from '../proxies/sandbox';
import { discoverProjects } from './discover-projects';

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
  return project;
}
