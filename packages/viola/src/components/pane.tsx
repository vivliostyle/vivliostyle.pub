import type { PaneContent } from '../stores/ui';
import { Editor } from './panes/editor';
import { Preview } from './panes/preview';
import { Settings } from './panes/settings';
import { Theme } from './panes/theme';

function ScrollOverflow({ children }: React.PropsWithChildren<object>) {
  return (
    <div className="size-full overflow-auto overscroll-contain scrollbar-stable">
      {children}
    </div>
  );
}

function PaneContainer({
  content,
  children,
}: React.PropsWithChildren<{ content: PaneContent }>) {
  return (
    <div className="pt-16 px-8 max-w-xl mx-auto grid gap-4">
      <h2 className="text-2xl font-bold">{content.title()}</h2>
      <div>{children}</div>
    </div>
  );
}

export function Pane({ content }: { content: PaneContent }) {
  switch (content.type) {
    case 'editor':
      return (
        <ScrollOverflow>
          <Editor {...content} />
        </ScrollOverflow>
      );
    case 'preview':
      return <Preview />;
    case 'theme':
      return (
        <ScrollOverflow>
          <PaneContainer {...{ content }}>
            <Theme />
          </PaneContainer>
        </ScrollOverflow>
      );
    case 'settings':
      return (
        <ScrollOverflow>
          <PaneContainer {...{ content }}>
            <Settings />
          </PaneContainer>
        </ScrollOverflow>
      );
    default:
      return null;
  }
}
