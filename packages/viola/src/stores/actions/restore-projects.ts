import { discoverProjects } from './discover-projects';

export async function restoreProjects() {
  await discoverProjects();
}
