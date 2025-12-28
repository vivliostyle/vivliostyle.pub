import { createFileRoute } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $project } from '../../../stores/project';
import { $ui } from '../../../stores/ui';

export const Route = createFileRoute('/(main)/_layout/')({
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await $project.setupPromise;
    $ui.tabs = [
      {
        id: generateId(),
        type: 'start',
      },
    ];
  },
});
