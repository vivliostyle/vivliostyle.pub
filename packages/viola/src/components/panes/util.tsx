import { invariant } from 'outvariant';
import { createContext, useContext } from 'react';

import { cn } from '@v/ui/lib/utils';

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

export function ScrollOverflow({ children }: React.PropsWithChildren<object>) {
  return (
    <div className="size-full overflow-auto overscroll-contain scrollbar-stable">
      {children}
    </div>
  );
}

export function PaneContainer({ children }: React.PropsWithChildren) {
  const context = useContext(PaneContext);
  invariant(context, 'PaneContext not found');

  return (
    <div
      className={cn(
        'pb-8 px-8 max-w-xl mx-auto grid gap-4',
        context.hideTitle ? 'pt-8' : 'pt-16',
      )}
    >
      <h2 className={cn('text-2xl font-bold', context.hideTitle && 'sr-only')}>
        <context.title {...context.props} />
      </h2>
      <div>{children}</div>
    </div>
  );
}
