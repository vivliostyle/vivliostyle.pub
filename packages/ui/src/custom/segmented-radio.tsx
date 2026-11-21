'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type * as React from 'react';

import { cn } from '../lib/utils';

/** Mutually exclusive options shown as one row of buttons. */
export function SegmentedRadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented-radio-group"
      orientation="horizontal"
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-8 w-fit items-center rounded-lg p-[3px]',
        className,
      )}
      {...props}
    />
  );
}

export function SegmentedRadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="segmented-radio-group-item"
      className={cn(
        "cursor-pointer text-foreground dark:text-muted-foreground data-[state=checked]:bg-accent-foreground data-[state=checked]:text-background dark:data-[state=checked]:border-input dark:data-[state=checked]:bg-input/30 dark:data-[state=checked]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-full items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}
