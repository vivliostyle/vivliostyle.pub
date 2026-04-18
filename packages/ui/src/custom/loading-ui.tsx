import { Loader2 } from 'lucide-react';

import { cn } from '../lib/utils';

export function LoadingUI({
  className,
  ref,
  children = 'Loading',
  ...props
}: React.OutputHTMLAttributes<HTMLOutputElement> & {
  ref?: React.Ref<HTMLOutputElement>;
}) {
  return (
    <span data-slot="loading-ui" className="pointer-events-none">
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      <output
        ref={ref}
        aria-live="polite"
        className={cn('sr-only', className)}
        {...props}
      >
        {children}
      </output>
    </span>
  );
}
