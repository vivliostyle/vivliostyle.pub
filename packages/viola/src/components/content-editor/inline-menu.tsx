import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import { cn } from '@v/ui/lib/utils';
import { useContainerRelativeRect } from '../../hooks/use-container-relative-rect';
import {
  getItemsForTrigger,
  inlineMenuState,
} from '../../libs/editor/inline-menu';

interface InlineMenuProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function InlineMenu({ containerRef }: InlineMenuProps) {
  const snap = useSnapshot(inlineMenuState);
  const isOpen =
    snap.trigger !== null && snap.coords !== null && snap.editor !== null;
  const items = snap.trigger ? getItemsForTrigger(snap.trigger) : [];

  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const positionSource = useMemo(
    () =>
      isOpen && snap.coords
        ? { top: snap.coords.bottom, left: snap.coords.left }
        : null,
    [isOpen, snap.coords],
  );
  const pos = useContainerRelativeRect(containerRef, positionSource);

  // Reset active highlight whenever a new menu opens.
  useEffect(() => {
    if (isOpen) setActiveIndex(0);
  }, [isOpen]);

  // Auto-close when menu scrolls out of viewport.
  useEffect(() => {
    if (!isOpen || !pos || !menuRef.current) return;
    const el = menuRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            inlineMenuState.closeInlineMenu();
          }
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, pos]);

  // Click outside closes the menu.
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        inlineMenuState.closeInlineMenu();
      }
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const selectItem = useCallback((index: number) => {
    const { editor, from, trigger } = inlineMenuState;
    if (!editor || !trigger) return;
    const list = getItemsForTrigger(trigger);
    const item = list[index];
    if (!item) return;
    inlineMenuState.closeInlineMenu();
    item.onSelect({
      editor,
      from,
      close: () => inlineMenuState.closeInlineMenu(),
    });
  }, []);

  // Keyboard navigation. We intercept events at the window level (capture)
  // so that the editor never sees the keys we handle, while still allowing
  // unhandled keys (e.g. plain typing) to fall through to the editor.
  useEffect(() => {
    if (!isOpen || items.length === 0) return;

    const handleKey = (e: KeyboardEvent) => {
      const { editor, from } = inlineMenuState;
      if (!editor) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          inlineMenuState.closeInlineMenu();
          editor
            .chain()
            .focus()
            .setTextSelection(from + 1)
            .run();
          return;
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setActiveIndex((i) => (i + 1) % items.length);
          return;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setActiveIndex((i) => (i - 1 + items.length) % items.length);
          return;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          e.stopPropagation();
          selectItem(activeIndex);
          return;
        case 'Backspace':
          e.preventDefault();
          e.stopPropagation();
          inlineMenuState.closeInlineMenu();
          editor
            .chain()
            .focus()
            .deleteRange({ from, to: from + 1 })
            .run();
          return;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            inlineMenuState.closeInlineMenu();
            editor.chain().focus().insertContent(e.key).run();
          }
      }
    };

    window.addEventListener('keydown', handleKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleKey, { capture: true });
  }, [isOpen, items, activeIndex, selectItem]);

  if (!isOpen || items.length === 0 || !pos) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        zIndex: 50,
      }}
      className="min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={cn(
              'flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
              i === activeIndex && 'bg-accent text-accent-foreground',
            )}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => selectItem(i)}
          >
            {Icon && <Icon className="size-4" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
