'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type * as React from 'react';

import { Loader2 } from '../icon';
import { Label } from '../label';
import { cn } from '../lib/utils';
import { RadioGroupItem } from '../radio';

export function StackedRadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-2', className)}
      {...props}
    />
  );
}

export function StackedRadioGroupItem({
  className,
  children,
  isLoading,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
  isLoading?: boolean;
}) {
  return (
    <Label
      className={cn(
        'cursor-pointer rounded-md transition-colors px-4 py-3 border border-input bg-background text-sm hover:bg-accent hover:text-accent-foreground has-checked:border-accent-foreground',
        className,
      )}
    >
      {isLoading && (
        <span className="size-4 shrink-0 *:size-full">
          <Loader2
            className="animate-spin stroke-foreground"
            strokeWidth={2.5}
            aria-hidden="true"
          />
        </span>
      )}
      <RadioGroupItem className={cn(isLoading && 'hidden')} {...props} />
      <div className="grid gap-1">{children}</div>
    </Label>
  );
}
