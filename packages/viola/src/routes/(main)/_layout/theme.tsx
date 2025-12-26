import { createFileRoute } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $ui } from '../../../stores/ui';

export const Route = createFileRoute('/(main)/_layout/theme')({
  component: () => null,
  onEnter: () => {
    $ui.tabs = [
      ...$ui.tabs.filter((t) => t.type === 'edit').slice(0, 1),
      {
        id: generateId(),
        type: 'theme',
      },
    ];
  },
});
