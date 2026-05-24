import { createFileRoute, redirect } from '@tanstack/react-router';

import { openProject } from '../../../../../stores/actions/open-project';
import type { ProjectId } from '../../../../../stores/proxies/project';

export const Route = createFileRoute('/(main)/_layout/projects/$projectId/')({
  beforeLoad: async ({ params, preload }) => {
    if (preload) {
      return;
    }
    const projectId = params.projectId as ProjectId;
    let project: Awaited<ReturnType<typeof openProject>>;
    try {
      project = await openProject(projectId);
    } catch {
      throw redirect({ to: '/' });
    }
    const contentId = project.content.readingOrder[0];
    const file = contentId ? project.content.files.get(contentId) : undefined;
    if (file) {
      throw redirect({
        to: '/projects/$projectId/edit/$',
        params: { projectId, _splat: file.filename },
        replace: true,
      });
    }
    throw redirect({
      to: '/projects/$projectId/bibliography',
      params: { projectId },
      replace: true,
    });
  },
});
