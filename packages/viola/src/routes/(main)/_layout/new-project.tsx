import { createFileRoute } from '@tanstack/react-router';

import { discoverProjects } from '../../../stores/actions/discover-projects';
import { showPane } from '../../../stores/actions/ui';
import { Project } from '../../../stores/proxies/project';

export const Route = createFileRoute('/(main)/_layout/new-project')({
  component: () => null,
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await discoverProjects();
    Project.createDraftProject();
    showPane({ type: 'new-project' });
  },
  onLeave: () => {
    void Project.disposeDraftProject();
  },
});
