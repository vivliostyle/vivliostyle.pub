'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

import { cn } from './lib/utils';

/**
 * Hover and keyboard focus only preview the card; a press pins it and moves
 * focus into it, so that its links and buttons can be reached.
 */
type OpenReason = 'hover' | 'focus' | 'press';

interface HoverPopoverContextValue {
  open: boolean;
  reasonRef: React.RefObject<OpenReason | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  restoreFocusRef: React.RefObject<boolean>;
  show: (reason: OpenReason) => void;
  close: () => void;
  scheduleOpen: (reason: OpenReason) => void;
  scheduleClose: () => void;
  cancel: (pending: OpenReason | 'close') => void;
}

const HoverPopoverContext =
  React.createContext<HoverPopoverContextValue | null>(null);

function useHoverPopoverContext() {
  const context = React.useContext(HoverPopoverContext);
  if (!context) {
    throw new Error('HoverPopover parts must be rendered in a HoverPopover');
  }
  return context;
}

// Like tooltips, at most one card is shown at a time.
let active: { owner: object; close: () => void } | null = null;

const isTouch = (event: React.PointerEvent) => event.pointerType === 'touch';

function HoverPopover({
  openDelay = 300,
  closeDelay = 150,
  children,
}: {
  openDelay?: number;
  closeDelay?: number;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const ownerRef = React.useRef({});
  const reasonRef = React.useRef<OpenReason | null>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRef = React.useRef<OpenReason | 'close' | null>(null);

  const clearPending = React.useCallback(() => {
    clearTimeout(timerRef.current);
    pendingRef.current = null;
  }, []);

  const close = React.useCallback(() => {
    clearPending();
    // Only a card that holds focus hands it back to the trigger; otherwise
    // closing would pull focus away from wherever the user moved it.
    restoreFocusRef.current =
      contentRef.current?.contains(document.activeElement) ?? false;
    reasonRef.current = null;
    if (active?.owner === ownerRef.current) {
      active = null;
    }
    setOpen(false);
  }, [clearPending]);

  const show = React.useCallback(
    (reason: OpenReason) => {
      clearPending();
      reasonRef.current = reason;
      if (active?.owner !== ownerRef.current) {
        active?.close();
        active = { owner: ownerRef.current, close };
      }
      setOpen(true);
    },
    [clearPending, close],
  );

  const schedule = React.useCallback(
    (pending: OpenReason | 'close', delay: number, run: () => void) => {
      clearPending();
      pendingRef.current = pending;
      timerRef.current = setTimeout(() => {
        pendingRef.current = null;
        run();
      }, delay);
    },
    [clearPending],
  );

  const value = React.useMemo<HoverPopoverContextValue>(
    () => ({
      open,
      reasonRef,
      contentRef,
      restoreFocusRef,
      show,
      close,
      scheduleOpen: (reason) => schedule(reason, openDelay, () => show(reason)),
      scheduleClose: () => schedule('close', closeDelay, close),
      cancel: (pending) => {
        if (pendingRef.current === pending) {
          clearPending();
        }
      },
    }),
    [open, show, close, schedule, clearPending, openDelay, closeDelay],
  );

  React.useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      if (active?.owner === ownerRef.current) {
        active = null;
      }
    },
    [],
  );

  return (
    <HoverPopoverContext.Provider value={value}>
      <PopoverPrimitive.Root
        data-slot="hover-popover"
        open={open}
        onOpenChange={(next) => (next ? show('press') : close())}
      >
        {children}
      </PopoverPrimitive.Root>
    </HoverPopoverContext.Provider>
  );
}

/**
 * The region whose hover opens the card, e.g. a label and its trigger. Keep
 * the content outside of it: React counts a portal as part of its parent.
 */
function HoverPopoverArea({
  asChild = false,
  onPointerEnter,
  onPointerLeave,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const { open, reasonRef, scheduleOpen, scheduleClose, cancel } =
    useHoverPopoverContext();
  const Comp = asChild ? Slot : 'div';

  return (
    <Comp
      data-slot="hover-popover-area"
      onPointerEnter={(event: React.PointerEvent<HTMLDivElement>) => {
        onPointerEnter?.(event);
        if (isTouch(event)) {
          return;
        }
        if (!open) {
          scheduleOpen('hover');
        } else {
          cancel('close');
        }
      }}
      onPointerLeave={(event: React.PointerEvent<HTMLDivElement>) => {
        onPointerLeave?.(event);
        if (isTouch(event)) {
          return;
        }
        cancel('hover');
        if (open && reasonRef.current === 'hover') {
          scheduleClose();
        }
      }}
      {...props}
    />
  );
}

function HoverPopoverTrigger({
  onClick,
  onFocus,
  onBlur,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const { open, reasonRef, contentRef, show, close, scheduleOpen, cancel } =
    useHoverPopoverContext();

  return (
    <PopoverPrimitive.Trigger
      data-slot="hover-popover-trigger"
      onClick={(event) => {
        onClick?.(event);
        // Skips Radix's toggle, which would close a previewed card that the
        // press means to pin.
        event.preventDefault();
        if (open && reasonRef.current === 'press') {
          close();
          return;
        }
        show('press');
        // A previewed card is already mounted and gets no open autofocus.
        if (open) {
          contentRef.current?.focus();
        }
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!open && event.currentTarget.matches(':focus-visible')) {
          scheduleOpen('focus');
        }
      }}
      onBlur={(event) => {
        onBlur?.(event);
        cancel('focus');
        if (open && reasonRef.current === 'focus') {
          close();
        }
      }}
      {...props}
    />
  );
}

function HoverPopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  collisionPadding = 8,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  ...props
}: Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, 'ref'>) {
  const { reasonRef, contentRef, restoreFocusRef, scheduleClose, cancel } =
    useHoverPopoverContext();

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={contentRef}
        data-slot="hover-popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-popover-content-available-height) w-72 origin-(--radix-popover-content-transform-origin) overflow-y-auto rounded-md border p-4 shadow-md outline-hidden',
          className,
        )}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          event.preventDefault();
          // The card itself rather than its first button, so that a screen
          // reader starts reading from the top.
          if (reasonRef.current === 'press') {
            contentRef.current?.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!restoreFocusRef.current) {
            event.preventDefault();
          }
        }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (!isTouch(event)) {
            cancel('close');
          }
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          // Working in the card pins it: a selection dragged past its edge
          // or a click that blurs the trigger would close a preview.
          cancel('close');
          reasonRef.current = 'press';
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          if (!isTouch(event) && reasonRef.current === 'hover') {
            scheduleClose();
          }
        }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export {
  HoverPopover,
  HoverPopoverArea,
  HoverPopoverContent,
  HoverPopoverTrigger,
};
