import { createFileRoute } from '@tanstack/react-router';

import { $projects, $ui } from '../../../stores/accessors';
import { discoverProjects } from '../../../stores/actions/discover-projects';

export const Route = createFileRoute('/(main)/_layout/')({
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await discoverProjects();
    $projects.currentProjectId = null;
    $ui.showPane({ type: 'start' });
  },
});
