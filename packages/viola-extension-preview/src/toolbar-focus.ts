import {
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

const itemSelector = 'button, input';

function focusableItems(toolbar: HTMLElement) {
  return [...toolbar.querySelectorAll<HTMLElement>(itemSelector)].filter(
    (item) =>
      !(item as HTMLButtonElement | HTMLInputElement).disabled &&
      item.checkVisibility(),
  );
}

function caretAtEdge(input: HTMLInputElement, forward: boolean) {
  const edge = forward ? input.value.length : 0;
  return input.selectionStart === edge && input.selectionEnd === edge;
}

/**
 * Gives a horizontal toolbar a single tab stop and moves focus between its
 * buttons and inputs with the arrow keys.
 */
export function useToolbarFocus(ref: RefObject<HTMLElement | null>) {
  const activeRef = useRef<HTMLElement | null>(null);

  const sync = useCallback(() => {
    const toolbar = ref.current;
    if (!toolbar) {
      return;
    }
    const items = focusableItems(toolbar);
    const active =
      activeRef.current && items.includes(activeRef.current)
        ? activeRef.current
        : items[0];
    for (const item of toolbar.querySelectorAll<HTMLElement>(itemSelector)) {
      item.tabIndex = item === active ? 0 : -1;
    }
  }, [ref]);

  // The tab stop must not stay on an item that a render has disabled.
  useLayoutEffect(() => sync());
  useEffect(() => {
    const toolbar = ref.current;
    if (!toolbar) {
      return;
    }
    // Container queries hide and show items without any render.
    const observer = new ResizeObserver(sync);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [ref, sync]);

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (event.target.matches(itemSelector)) {
      activeRef.current = event.target;
      sync();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const toolbar = ref.current;
    const target = event.target as HTMLElement;
    if (
      !toolbar ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const items = focusableItems(toolbar);
    const index = items.indexOf(target);
    if (index < 0) {
      return;
    }
    const input = target instanceof HTMLInputElement ? target : null;
    let next: number;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const rtl = getComputedStyle(toolbar).direction === 'rtl';
      const forward = (event.key === 'ArrowRight') !== rtl;
      // An input keeps the arrow keys for its caret until the caret reaches
      // the edge it would leave by.
      if (input && !caretAtEdge(input, forward)) {
        return;
      }
      next = (index + (forward ? 1 : -1) + items.length) % items.length;
    } else if (!input && event.key === 'Home') {
      next = 0;
    } else if (!input && event.key === 'End') {
      next = items.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    items[next]?.focus();
  };

  return { onFocus, onKeyDown };
}
