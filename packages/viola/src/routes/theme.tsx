import { createFileRoute } from '@tanstack/react-router';
import { ref } from 'valtio';

import { generateId } from '../libs/generate-id';
import { $ui, type PaneContent } from '../stores/ui';

export const Route = createFileRoute('/theme')({
  component: () => null,
  onEnter: () => {
    const content = {
      id: generateId(),
      type: 'theme',
      title: ref(() => <>Customize theme</>),
    } satisfies PaneContent;
    $ui.tabs = [
      ...$ui.tabs.filter((t) => t.type === 'edit').slice(0, 1),
      content,
    ];
  },
});
