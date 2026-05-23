import { $projects } from '../accessors';
import { discoverProjects } from './discover-projects';
import { getLastOpenedProjectId, openProject } from './open-project';

export async function restoreProjects() {
  await discoverProjects();

  if ($projects.currentProjectId) {
    return;
  }
  const lastOpened = getLastOpenedProjectId();
  if (lastOpened && lastOpened in $projects.entries) {
    try {
      await openProject(lastOpened);
    } catch {
      // last-opened project might be missing or corrupted; fall through.
    }
  }
}
