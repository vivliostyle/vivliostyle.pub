import { createFileRoute, redirect } from '@tanstack/react-router';

import { generateId } from '../../../../../libs/generate-id';
import { $ui } from '../../../../../stores/accessors';
import { openProject } from '../../../../../stores/actions/open-project';
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
    if (
      $ui.tabs.some(
        (tab) => tab.type === 'extension' && tab.extensionId === 'preview',
      )
    ) {
      return;
    }
    $ui.tabs = [
      {
        id: generateId(),
        type: 'extension',
        extensionId: 'preview' as ExtensionId,
        panePath: '.',
      },
    ];
  },
});
