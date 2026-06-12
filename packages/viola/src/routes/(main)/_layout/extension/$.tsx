import { createFileRoute, redirect } from '@tanstack/react-router';

import { generateId } from '../../../../libs/generate-id';
import { $ui } from '../../../../stores/accessors';
import { ensureExtensionsActivated } from '../../../../stores/actions/extension';
import { findPermalink } from '../../../../stores/proxies/extension';

export const Route = createFileRoute('/(main)/_layout/extension/$')({
  component: () => null,
  beforeLoad: async ({ preload, params }) => {
    if (preload) {
      return;
    }
    await ensureExtensionsActivated();
    const permalink = findPermalink(params._splat ?? '');
    if (!permalink) {
      throw redirect({ to: '/' });
    }
    if (
      $ui.tabs.some(
        (tab) =>
          tab.type === 'extension' &&
          tab.extensionId === permalink.extensionId &&
          tab.panePath === permalink.panePath,
      )
    ) {
      return;
    }
    $ui.tabs = [
      ...$ui.tabs.filter((tab) => tab.type === 'edit').slice(0, 1),
      {
        id: generateId(),
        type: 'extension',
        extensionId: permalink.extensionId,
        panePath: permalink.panePath,
      },
    ];
  },
});
