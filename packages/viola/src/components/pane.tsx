import { Suspense } from 'react';

import { Loader2 } from '@v/ui/icon';
import type { PaneContent } from '../stores/ui';
import { Bibliography } from './panes/bibliography';
import { Edit } from './panes/edit';
import { Preview } from './panes/preview';
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
    <div className="pt-16 pb-8 px-8 max-w-xl mx-auto grid gap-4">
      <h2 className="text-2xl font-bold">{content.title()}</h2>
      <div>{children}</div>
    </div>
  );
}

export function Pane({ content }: { content: PaneContent }) {
  return (
    <Suspense
      fallback={
        <div className="grid place-items-center size-full">
          <Loader2 className="animate-spin size-12 text-gray-300" />
        </div>
      }
    >
      {(() => {
        switch (content.type) {
          case 'bibliography':
            return (
              <ScrollOverflow>
                <PaneContainer {...{ content }}>
                  <Bibliography />
                </PaneContainer>
              </ScrollOverflow>
            );
          case 'edit':
            return (
              <ScrollOverflow>
                <Edit {...content} />
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
          default:
            return null;
        }
      })()}
    </Suspense>
  );
}
