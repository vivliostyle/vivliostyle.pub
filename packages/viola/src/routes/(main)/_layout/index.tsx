import { createFileRoute } from '@tanstack/react-router';

import { $projects } from '../../../stores/accessors';
import { discoverProjects } from '../../../stores/actions/discover-projects';
import { showPane } from '../../../stores/actions/ui';

export const Route = createFileRoute('/(main)/_layout/')({
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await discoverProjects();
    $projects.currentProjectId = null;
    showPane({ type: 'start' });
  },
});
