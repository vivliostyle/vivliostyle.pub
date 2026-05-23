import { createFileRoute, redirect } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $projects, $ui } from '../../../stores/accessors';
import { restoreProjects } from '../../../stores/actions/restore-projects';

export const Route = createFileRoute('/(main)/_layout/theme')({
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await restoreProjects();
    if (!$projects.currentProjectId) {
      throw redirect({ to: '/' });
    }
    $ui.tabs = [
      ...$ui.tabs.filter((t) => t.type === 'edit').slice(0, 1),
      {
        id: generateId(),
        type: 'theme',
      },
    ];
  },
});
