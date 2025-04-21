import { createFileRoute } from '@tanstack/react-router';
import { generateId } from '../libs/generate-id';
import { type PaneContent, ui } from '../stores/ui';

export const Route = createFileRoute('/settings')({
  component: Settings,
  onEnter: (context) => {
    const content = {
      id: generateId(),
      type: 'settings',
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
