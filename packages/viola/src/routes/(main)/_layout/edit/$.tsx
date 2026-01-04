import { createFileRoute, redirect } from '@tanstack/react-router';

import { generateId } from '../../../../libs/generate-id';
import { $content, $project, $ui } from '../../../../stores/accessors';

export const Route = createFileRoute('/(main)/_layout/edit/$')({
  beforeLoad: async ({ params, preload }) => {
    if (preload) {
      return;
    }
    await $project.valueOrThrow.setupPromise;
    const result = $content.valueOrThrow.getFileByFilename(params._splat || '');
    const contentId = result?.[0];
    if (!contentId) {
      throw redirect({ to: '/' });
    }
    if (
      $ui.tabs.some((tab) => tab.type === 'edit' && tab.contentId === contentId)
    ) {
      return;
    }
    $ui.tabs = [
      {
        id: generateId(),
        type: 'edit',
        contentId,
      },
    ];
  },
});
