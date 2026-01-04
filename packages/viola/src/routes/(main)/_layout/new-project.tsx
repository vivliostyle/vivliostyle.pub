import { createFileRoute } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $ui } from '../../../stores/accessors';

export const Route = createFileRoute('/(main)/_layout/new-project')({
  component: () => null,
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    $ui.tabs = [
      {
        id: generateId(),
        type: 'new-project',
      },
    ];
  },
});
