import { $ui } from '../accessors';
import { discoverProjects } from './discover-projects';

// The modal opens without a route transition, so the discovery that the
// start route's beforeLoad runs never happens.
export function openProjectsModal(): void {
  $ui.openModal({ type: 'start' });
  discoverProjects().catch((err) => {
    console.error('[ui] discoverProjects failed', err);
  });
}
