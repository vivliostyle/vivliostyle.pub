import { createFileRoute } from '@tanstack/react-router';
import { ref } from 'valtio';

import { generateId } from '../../../libs/generate-id';
import { $ui } from '../../../stores/ui';

export const Route = createFileRoute('/(main)/_layout/preview')({
  component: () => null,
  onEnter: () => {
    $ui.tabs = [
      {
        id: generateId(),
        type: 'preview',
        title: ref(() => <>Preview</>),
      },
    ];
  },
});
