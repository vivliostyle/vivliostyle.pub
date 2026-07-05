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
    // Keep an existing preview tab's id so the viewer iframe doesn't remount
    // when trimming other panes away.
    const existingTab = $ui.tabs.find(
      (tab) => tab.type === 'extension' && tab.extensionId === 'preview',
    );
    if (existingTab && $ui.tabs.length === 1) {
      return;
    }
    $ui.tabs = [
      existingTab ?? {
        id: generateId(),
        type: 'extension',
        extensionId: 'preview' as ExtensionId,
        panePath: '.',
      },
    ];
  },
});
