import { $projects } from '../accessors';
import { Project, type ProjectId } from '../proxies/project';
import { Sandbox } from '../proxies/sandbox';

export async function restoreProjects() {
  if ($projects.currentProjectId) {
    return;
  }
  const projectId = 'alpha-v1' as ProjectId;
  if (await Sandbox.checkFilesystemExists({ projectId })) {
    const sandboxPromise = Sandbox.createSandboxFromFilesystem({ projectId });
    Project.createProjectFromSandbox({ projectId, sandboxPromise });
    $projects.currentProjectId = projectId;
  }
}
