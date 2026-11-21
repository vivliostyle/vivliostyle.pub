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

/** `value` names the trigger the card belongs to, and stays while it closes. */
interface CardState {
  open: boolean;
  value: string | null;
}

type Pending = { kind: OpenReason | 'close'; value: string | null };

interface HoverPopoverContextValue {
  contentId: string;
  getState: () => CardState;
  subscribe: (listener: () => void) => () => void;
  reasonRef: React.RefObject<OpenReason | null>;
  anchorRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  restoreFocusRef: React.RefObject<boolean>;
  registerTrigger: (value: string, element: HTMLElement | null) => void;
  show: (reason: OpenReason, value: string) => void;
  close: () => void;
  scheduleOpen: (reason: OpenReason, value: string) => void;
  scheduleClose: () => void;
  cancel: (kind: Pending['kind'], value?: string) => void;
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

function useCardState(): CardState {
  const { getState, subscribe } = useHoverPopoverContext();
  return React.useSyncExternalStore(subscribe, getState);
}

/** Re-renders a trigger only when its own card opens or closes. */
function useIsShown(value: string): boolean {
  const { getState, subscribe } = useHoverPopoverContext();
  return React.useSyncExternalStore(subscribe, () => {
    const state = getState();
    return state.open && state.value === value;
  });
}

// Like tooltips, at most one card is shown at a time.
let active: { owner: object; close: () => void } | null = null;

const isTouch = (event: React.PointerEvent) => event.pointerType === 'touch';

type AnchorRef = NonNullable<
  React.ComponentProps<typeof PopoverPrimitive.Anchor>['virtualRef']
>;

/**
 * One card shared by every trigger inside, each naming its card by `value`.
 * A long list of triggers then mounts no per-item state or popover machinery,
 * and a trigger re-renders only when its own card opens or closes.
 */
function HoverPopover({
  openDelay = 300,
  closeDelay = 150,
  children,
}: {
  openDelay?: number;
  closeDelay?: number;
  children?: React.ReactNode;
}) {
  const contentId = React.useId();
  const ownerRef = React.useRef({});
  const stateRef = React.useRef<CardState>({ open: false, value: null });
  const listenersRef = React.useRef(new Set<() => void>());
  const triggersRef = React.useRef(new Map<string, HTMLElement>());
  const reasonRef = React.useRef<OpenReason | null>(null);
  const anchorRef = React.useRef<HTMLElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRef = React.useRef<Pending | null>(null);
  const delaysRef = React.useRef({ openDelay, closeDelay });
  React.useLayoutEffect(() => {
    delaysRef.current = { openDelay, closeDelay };
  });

  const value = React.useMemo<HoverPopoverContextValue>(() => {
    const setState = (next: CardState) => {
      stateRef.current = next;
      for (const listener of listenersRef.current) {
        listener();
      }
    };
    const clearPending = () => {
      clearTimeout(timerRef.current);
      pendingRef.current = null;
    };
    const close = () => {
      clearPending();
      // Only a card that holds focus hands it back to the trigger; otherwise
      // closing would pull focus away from wherever the user moved it.
      restoreFocusRef.current =
        contentRef.current?.contains(document.activeElement) ?? false;
      reasonRef.current = null;
      if (active?.owner === ownerRef.current) {
        active = null;
      }
      if (stateRef.current.open) {
        setState({ ...stateRef.current, open: false });
      }
    };
    const show = (reason: OpenReason, value: string) => {
      const trigger = triggersRef.current.get(value);
      if (!trigger) {
        return;
      }
      clearPending();
      reasonRef.current = reason;
      anchorRef.current = trigger;
      if (active?.owner !== ownerRef.current) {
        active?.close();
        active = { owner: ownerRef.current, close };
      }
      setState({ open: true, value });
    };
    const schedule = (pending: Pending, delay: number, run: () => void) => {
      clearPending();
      pendingRef.current = pending;
      timerRef.current = setTimeout(() => {
        pendingRef.current = null;
        run();
      }, delay);
    };
    return {
      contentId,
      getState: () => stateRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
      reasonRef,
      anchorRef,
      contentRef,
      restoreFocusRef,
      registerTrigger: (value, element) => {
        if (element) {
          triggersRef.current.set(value, element);
          return;
        }
        triggersRef.current.delete(value);
        if (stateRef.current.open && stateRef.current.value === value) {
          close();
        }
      },
      show,
      close,
      scheduleOpen: (reason, value) =>
        schedule({ kind: reason, value }, delaysRef.current.openDelay, () =>
          show(reason, value),
        ),
      scheduleClose: () =>
        schedule(
          { kind: 'close', value: null },
          delaysRef.current.closeDelay,
          close,
        ),
      cancel: (kind, value) => {
        const pending = pendingRef.current;
        if (
          pending?.kind === kind &&
          (value === undefined || pending.value === value)
        ) {
          clearPending();
        }
      },
    };
  }, [contentId]);

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
      {children}
    </HoverPopoverContext.Provider>
  );
}

/**
 * The region whose hover opens the card of `value`, e.g. a label and its
 * trigger. Keep the content outside of it: React counts a portal as part of
 * its parent.
 */
function HoverPopoverArea({
  value,
  asChild = false,
  onPointerEnter,
  onPointerLeave,
  ...props
}: React.ComponentProps<'div'> & { value: string; asChild?: boolean }) {
  const { getState, reasonRef, scheduleOpen, scheduleClose, cancel } =
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
        const state = getState();
        if (state.open && state.value === value) {
          cancel('close');
        } else {
          scheduleOpen('hover', value);
        }
      }}
      onPointerLeave={(event: React.PointerEvent<HTMLDivElement>) => {
        onPointerLeave?.(event);
        if (isTouch(event)) {
          return;
        }
        cancel('hover', value);
        const state = getState();
        if (
          state.open &&
          state.value === value &&
          reasonRef.current === 'hover'
        ) {
          scheduleClose();
        }
      }}
      {...props}
    />
  );
}

/**
 * A plain element rather than Radix's trigger, so that closed cards mount no
 * popover machinery. The parts here stand in for what that trigger did: its
 * ARIA state, its outside-click exemption and the focus return.
 */
function HoverPopoverTrigger({
  value,
  asChild = false,
  ref,
  onClick,
  onFocus,
  onBlur,
  ...props
}: React.ComponentProps<'button'> & { value: string; asChild?: boolean }) {
  const {
    contentId,
    getState,
    reasonRef,
    contentRef,
    registerTrigger,
    show,
    close,
    scheduleOpen,
    cancel,
  } = useHoverPopoverContext();
  const shown = useIsShown(value);
  const Comp = asChild ? Slot : 'button';
  const setRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      registerTrigger(value, node);
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref, registerTrigger, value],
  );

  return (
    <Comp
      ref={setRef}
      type={asChild ? undefined : 'button'}
      data-slot="hover-popover-trigger"
      aria-haspopup="dialog"
      aria-expanded={shown}
      aria-controls={shown ? contentId : undefined}
      data-state={shown ? 'open' : 'closed'}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (shown && reasonRef.current === 'press') {
          close();
          return;
        }
        // A card already open, if for another trigger, stays mounted and
        // gets no open autofocus.
        const mounted = getState().open;
        show('press', value);
        if (mounted) {
          contentRef.current?.focus();
        }
      }}
      onFocus={(event: React.FocusEvent<HTMLButtonElement>) => {
        onFocus?.(event);
        if (!shown && event.currentTarget.matches(':focus-visible')) {
          scheduleOpen('focus', value);
        }
      }}
      onBlur={(event: React.FocusEvent<HTMLButtonElement>) => {
        onBlur?.(event);
        cancel('focus', value);
        if (shown && reasonRef.current === 'focus') {
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
  onInteractOutside,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof PopoverPrimitive.Content>,
  'ref' | 'children'
> & {
  /** Renders the card of the trigger named `value`. */
  children: (value: string) => React.ReactNode;
}) {
  const {
    contentId,
    reasonRef,
    anchorRef,
    contentRef,
    restoreFocusRef,
    show,
    close,
    scheduleClose,
    cancel,
  } = useHoverPopoverContext();
  const { open, value } = useCardState();
  const [mounted, setMounted] = React.useState(false);
  if (open && !mounted) {
    setMounted(true);
  }
  const interactedOutsideRef = React.useRef(false);

  if (!mounted || value === null) {
    return null;
  }
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => (next ? show('press', value) : close())}
    >
      <PopoverPrimitive.Anchor virtualRef={anchorRef as AnchorRef} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          id={contentId}
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
            if (!event.defaultPrevented) {
              if (restoreFocusRef.current && !interactedOutsideRef.current) {
                anchorRef.current?.focus();
              }
              event.preventDefault();
            }
            interactedOutsideRef.current = false;
          }}
          onInteractOutside={(event) => {
            onInteractOutside?.(event);
            // The trigger's own click decides whether to pin or close.
            if (anchorRef.current?.contains(event.target as Node)) {
              event.preventDefault();
            } else if (!event.defaultPrevented) {
              interactedOutsideRef.current = true;
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
        >
          {children(value)}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export {
  HoverPopover,
  HoverPopoverArea,
  HoverPopoverContent,
  HoverPopoverTrigger,
};
