import { createFileRoute } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $ui } from '../../../stores/accessors';
import { restoreProjects } from '../../../stores/actions/restore-projects';
import { Project } from '../../../stores/proxies/project';

export const Route = createFileRoute('/(main)/_layout/new-project')({
  component: () => null,
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await restoreProjects();
    Project.createDraftProject();
    $ui.tabs = [
      {
        id: generateId(),
        type: 'new-project',
      },
    ];
  },
});
