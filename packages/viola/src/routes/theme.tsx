import { createFileRoute } from '@tanstack/react-router';
import { ref } from 'valtio';
import { generateId } from '../libs/generate-id';
import { type PaneContent, ui } from '../stores/ui';

export const Route = createFileRoute('/theme')({
  component: Settings,
  onEnter: () => {
    const content = {
      id: generateId(),
      type: 'theme',
      title: ref(() => <>Customize theme</>),
    } satisfies PaneContent;
    ui.tabs = [content, ...ui.tabs.slice(1)];
  },
});

function Settings() {
  return null;
}
