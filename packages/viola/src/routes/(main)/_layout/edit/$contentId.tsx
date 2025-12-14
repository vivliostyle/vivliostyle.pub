import { createFileRoute, redirect } from '@tanstack/react-router';
import { ref } from 'valtio';

import { generateId } from '../../../../libs/generate-id';
import { $content, type ContentId } from '../../../../stores/content';
import { $ui } from '../../../../stores/ui';

export const Route = createFileRoute('/(main)/_layout/edit/$contentId')({
  component: () => null,
  beforeLoad: ({ params }) => {
    const contentId = params.contentId as ContentId;
    if (!$content.files.has(contentId)) {
      throw redirect({ to: '/' });
    }
  },
  onEnter: ({ params }) => {
    const contentId = params.contentId as ContentId;
    if (!$content.files.has(contentId)) {
      return;
    }
    $ui.tabs = [
      {
        id: generateId(),
        type: 'edit',
        contentId: contentId,
        title: ref(() => <>Editor</>),
      },
    ];
  },
});
