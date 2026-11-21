import { createFileRoute, redirect } from '@tanstack/react-router';

import { openProject } from '../../../../../stores/actions/open-project';
import { showPane } from '../../../../../stores/actions/ui';
import type { ExtensionId } from '../../../../../stores/proxies/extension';
import type { ProjectId } from '../../../../../stores/proxies/project';

export const Route = createFileRoute(
  '/(main)/_layout/projects/$projectId/preview',
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
    showPane(
      {
        type: 'extension',
        extensionId: 'preview' as ExtensionId,
        panePath: '.',
      },
      { keepIfShown: true },
    );
  },
});
