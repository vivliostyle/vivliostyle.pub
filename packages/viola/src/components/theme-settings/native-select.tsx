import { cn } from '@v/ui/lib/utils';

// Native rather than Radix: a settings list mounts hundreds of these, and
// keyboard and screen-reader support come for free.
export function NativeSelect({
  className,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={cn(
        'h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
    />
  );
}
