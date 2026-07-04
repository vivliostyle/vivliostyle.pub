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
    // Reuse an existing preview tab (keeping its id so the viewer iframe
    // doesn't remount) while still trimming any other panes, so this route is
    // a reliable escape from a split layout.
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
