import { createFileRoute, redirect } from '@tanstack/react-router';

import { generateId } from '../../../../../libs/generate-id';
import { $ui } from '../../../../../stores/accessors';
import { openProject } from '../../../../../stores/actions/open-project';
import type { ProjectId } from '../../../../../stores/proxies/project';

export const Route = createFileRoute(
  '/(main)/_layout/projects/$projectId/bibliography',
)({
  component: () => null,
  beforeLoad: async ({ params, preload }) => {
    if (preload) {
      return;
    }
    try {
      await openProject(params.projectId as ProjectId);
    } catch {
      throw redirect({ to: '/' });
    }
    $ui.tabs = [
      ...$ui.tabs.filter((t) => t.type === 'edit').slice(0, 1),
      {
        id: generateId(),
        type: 'bibliography',
      },
    ];
  },
});
