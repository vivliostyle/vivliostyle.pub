import { createFileRoute } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $ui } from '../../../stores/accessors';
import { restoreProjects } from '../../../stores/actions/restore-projects';

export const Route = createFileRoute('/(main)/_layout/preview')({
  component: () => null,
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await restoreProjects();
    $ui.tabs = [
      {
        id: generateId(),
        type: 'preview',
      },
    ];
  },
});
