import { createFileRoute } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $ui } from '../../../stores/accessors';
import { discoverProjects } from '../../../stores/actions/discover-projects';
import { Project } from '../../../stores/proxies/project';

export const Route = createFileRoute('/(main)/_layout/new-project')({
  component: () => null,
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await discoverProjects();
    Project.createDraftProject();
    $ui.tabs = [
      {
        id: generateId(),
        type: 'new-project',
      },
    ];
  },
});
