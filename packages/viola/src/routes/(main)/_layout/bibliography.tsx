import { createFileRoute } from '@tanstack/react-router';

import { generateId } from '../../../libs/generate-id';
import { $ui } from '../../../stores/accessors';

export const Route = createFileRoute('/(main)/_layout/bibliography')({
  component: () => null,
  onEnter: () => {
    $ui.tabs = [
      ...$ui.tabs.filter((t) => t.type === 'edit').slice(0, 1),
      {
        id: generateId(),
        type: 'bibliography',
      },
    ];
  },
});
