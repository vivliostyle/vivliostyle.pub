import { createFileRoute } from '@tanstack/react-router';

import { generateId } from '../../../../libs/generate-id';
import { $projects, $ui } from '../../../../stores/accessors';
import { restoreSession } from '../../../../stores/actions/session';

export const Route = createFileRoute('/(main)/_layout/settings/account')({
  component: () => null,
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    await restoreSession();
    $projects.currentProjectId = null;
    $ui.tabs = [
      {
        id: generateId(),
        type: 'account',
      },
    ];
  },
});
