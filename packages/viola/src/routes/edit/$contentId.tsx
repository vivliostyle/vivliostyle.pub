import { createFileRoute, redirect } from '@tanstack/react-router';
import { ref } from 'valtio';
import { generateId } from '../../libs/generate-id';
import { type ContentId, content } from '../../stores/content';
import { ui } from '../../stores/ui';

export const Route = createFileRoute('/edit/$contentId')({
  component: () => null,
  beforeLoad: ({ params }) => {
    const contentId = params.contentId as ContentId;
    if (!content.files[contentId]) {
      throw redirect({ to: '/' });
    }
  },
  onEnter: ({ params }) => {
    const contentId = params.contentId as ContentId;
    if (!content.files[contentId]) {
      return;
    }
    ui.tabs = [
      {
        id: generateId(),
        type: 'edit',
        contentId: contentId,
        title: ref(() => <>Editor</>),
      },
      {
        id: generateId(),
        type: 'preview',
        title: ref(() => <>Preview</>),
      },
    ];
  },
});
