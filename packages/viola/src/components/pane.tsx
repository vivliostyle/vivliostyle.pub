import { invariant } from 'outvariant';
import { Suspense, useContext } from 'react';

import { Loader2 } from '@v/ui/icon';
import type { PaneContent } from '../stores/ui';
import { PaneContext, type PaneDefinition } from './panes/util';

export const panes = Object.fromEntries(
  Object.entries(
    import.meta.glob('./panes/pane.*', {
      eager: true,
      import: 'Pane',
    }),
  ).map(([path, module]) => {
    const matched = path.match(/pane\.(\w+)\.tsx$/);
    invariant(matched, 'Unknown pane: %s', path);
    return [matched[1], module];
  }),
) as {
  [K in keyof PanePropertyMap]: PaneDefinition<PanePropertyMap[K]>;
};

export function Pane({
  content: { type, ...props },
}: {
  content: PaneContent;
}) {
  const pane = panes[type];
  invariant(pane, 'Unknown pane: %s', type);
  type Props = PanePropertyMap[typeof type];
  const Component = pane.content as React.ComponentType<Props>;
  const parentContext = useContext(PaneContext);

  return (
    <PaneContext.Provider value={{ ...pane, props, ...(parentContext ?? {}) }}>
      <Suspense
        fallback={
          <div className="grid place-items-center size-full">
            <Loader2 className="animate-spin size-12 text-gray-300" />
          </div>
        }
      >
        <Component {...(props as Props)} />
      </Suspense>
    </PaneContext.Provider>
  );
}
