import { invariant } from 'outvariant';
import { createContext, useContext } from 'react';

import { ScrollOverflow, PaneContainer as UiPaneContainer } from '@v/ui/pane';

export { ScrollOverflow };

export interface PaneDefinition<P> {
  title: React.ComponentType<P>;
  content: React.ComponentType<P>;
  hideTitle?: boolean;
}

export function createPane<P, D = PaneDefinition<P>>(definition: D): D {
  return definition;
}

export const PaneContext = createContext<
  // biome-ignore lint/suspicious/noExplicitAny: any
  (PaneDefinition<any> & { props: any }) | null
>(null);

// Binds the `@v/ui` pane layout to the active pane's context, so core panes get
// their title and `hideTitle` automatically. Extensions use the prop-based
// `@v/ui/pane` component directly instead.
export function PaneContainer({
  fullWidth,
  children,
}: React.PropsWithChildren<{ fullWidth?: boolean }>) {
  const context = useContext(PaneContext);
  invariant(context, 'PaneContext not found');

  return (
    <UiPaneContainer
      title={<context.title {...context.props} />}
      hideTitle={context.hideTitle}
      fullWidth={fullWidth}
    >
      {children}
    </UiPaneContainer>
  );
}
