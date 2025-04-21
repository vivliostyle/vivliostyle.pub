import type { PaneContent } from '../stores/ui';
import { Editor } from './panes/editor';
import { Preview } from './panes/preview';
import { Settings } from './panes/settings';

export function Pane({ content }: { content: PaneContent }) {
  switch (content.type) {
    case 'editor':
      return <Editor {...content} />;
    case 'preview':
      return <Preview />;
    case 'settings':
      return <Settings />;
    default:
      return null;
  }
}
