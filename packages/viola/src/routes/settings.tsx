import { createFileRoute } from '@tanstack/react-router';
import { ref } from 'valtio';
import { generateId } from '../libs/generate-id';
import { type PaneContent, ui } from '../stores/ui';

export const Route = createFileRoute('/settings')({
  component: Settings,
  onEnter: () => {
    const content = {
      id: generateId(),
      type: 'settings',
      title: ref(() => <>Settings</>),
    } satisfies PaneContent;
    if (ui.tabs.length === 0) {
      ui.tabs = [content];
    } else {
      ui.dedicatedModal = content;
    }
  },
});

function Settings() {
  return null;
}
