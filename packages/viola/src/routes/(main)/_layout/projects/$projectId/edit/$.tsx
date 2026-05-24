import { createFileRoute, redirect } from '@tanstack/react-router';

import { generateId } from '../../../../../../libs/generate-id';
import { $content, $ui } from '../../../../../../stores/accessors';
import { openProject } from '../../../../../../stores/actions/open-project';
import type { ProjectId } from '../../../../../../stores/proxies/project';

export const Route = createFileRoute(
  '/(main)/_layout/projects/$projectId/edit/$',
)({
  beforeLoad: async ({ params, preload }) => {
    if (preload) {
      return;
    }
    try {
      await openProject(params.projectId as ProjectId);
    } catch {
      throw redirect({ to: '/' });
    }
    const result = $content
      .valueOrThrow()
      .getFileByFilename(params._splat || '');
    const contentId = result?.[0];
    if (!contentId) {
      throw redirect({
        to: '/projects/$projectId',
        params: { projectId: params.projectId },
      });
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
