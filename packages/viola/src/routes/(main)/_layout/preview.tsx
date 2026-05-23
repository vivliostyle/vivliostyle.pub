import { createFileRoute, redirect } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $projects, $ui } from '../../../stores/accessors';
import { restoreProjects } from '../../../stores/actions/restore-projects';

export const Route = createFileRoute('/(main)/_layout/preview')({
  component: () => null,
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await restoreProjects();
    if (!$projects.currentProjectId) {
      throw redirect({ to: '/' });
    }
    $ui.tabs = [
      {
        id: generateId(),
        type: 'preview',
      },
    ];
  },
});
