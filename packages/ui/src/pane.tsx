import type { ReactNode } from 'react';

import { cn } from './lib/utils';

export function ScrollOverflow({ children }: { children?: ReactNode }) {
  return (
    <div className="size-full overflow-auto overscroll-contain scrollbar-stable">
      {children}
    </div>
  );
}

export function PaneContainer({
  title,
  hideTitle,
  children,
}: {
  title?: ReactNode;
  hideTitle?: boolean;
  children?: ReactNode;
}) {
  const showsTitle = title !== undefined && !hideTitle;
  return (
    <div
      className={cn(
        'pb-8 px-8 max-w-xl mx-auto grid gap-4',
        showsTitle ? 'pt-16' : 'pt-8',
      )}
    >
      {title !== undefined && (
        <h2 className={cn('text-2xl font-bold', hideTitle && 'sr-only')}>
          {title}
        </h2>
      )}
      <div>{children}</div>
    </div>
  );
}
