import { createFileRoute, redirect } from '@tanstack/react-router';

import { $ui } from '../../../../../stores/accessors';
import { openProject } from '../../../../../stores/actions/open-project';
import type { ProjectId } from '../../../../../stores/proxies/project';

export const Route = createFileRoute(
  '/(main)/_layout/projects/$projectId/media',
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
    $ui.showPane({ type: 'media' }, { besideEditor: true, keepIfShown: true });
  },
});
