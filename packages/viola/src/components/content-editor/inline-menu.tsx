import {
  autoUpdate,
  computePosition,
  hide,
  type VirtualElement,
} from '@floating-ui/react-dom';
import { useCallback, useEffect, useRef } from 'react';
import { useSnapshot } from 'valtio';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@v/ui/dropdown';
import {
  getItemsForTrigger,
  inlineMenuState,
} from '../../libs/editor/inline-menu';
import { $content } from '../../stores/accessors';

const MENU_KEYS = ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'];

export function InlineMenu() {
  const snap = useSnapshot(inlineMenuState);

  const isOpen =
    snap.trigger !== null && snap.coords !== null && snap.contentId !== null;

  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const triggerEl = triggerRef.current;
    const { contentId } = inlineMenuState;
    if (!contentId) return;
    const editor = $content.valueOrThrow().files.get(contentId)?.editor;
    if (!editor) return;

    const reference: VirtualElement = {
      getBoundingClientRect() {
        const { from } = inlineMenuState;
        const { top, bottom, left } = editor.view.coordsAtPos(from);
        return {
          width: 0,
          height: bottom - top,
          x: left,
          y: top,
          top,
          bottom,
          left,
          right: left,
          toJSON() {
            return this;
          },
        };
      },
      contextElement: editor.view.dom,
    };

    async function update() {
      const rect = reference.getBoundingClientRect();
      inlineMenuState.coords = {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
      };

      const { middlewareData } = await computePosition(reference, triggerEl, {
        middleware: [hide()],
      });
      if (middlewareData.hide?.referenceHidden) {
        inlineMenuState.closeInlineMenu();
      }
    }

    return autoUpdate(reference, triggerEl, update);
  }, [isOpen]);

  // Capture keydown events to close the menu on Escape, and prevent it from
  // reaching Radix's DismissableLayer.
  useEffect(() => {
    if (!isOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      const { contentId, from } = inlineMenuState;
      inlineMenuState.closeInlineMenu();
      if (!contentId) return;
      const editor = $content.valueOrThrow().files.get(contentId)?.editor;
      editor
        ?.chain()
        .focus()
        .setTextSelection(from + 1)
        .run();
    }
    window.addEventListener('keydown', handleEscape, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleEscape, { capture: true });
  }, [isOpen]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (MENU_KEYS.includes(e.key)) return;

    const { contentId, from } = inlineMenuState;
    if (!contentId) return;
    const editor = $content.valueOrThrow().files.get(contentId)?.editor;
    if (!editor) return;

    e.preventDefault();
    inlineMenuState.closeInlineMenu();

    if (e.key === 'Backspace') {
      editor
        .chain()
        .focus()
        .deleteRange({ from, to: from + 1 })
        .run();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      editor.chain().focus().insertContent(e.key).run();
      return;
    }
    editor.commands.focus();
  }, []);

  const items = snap.trigger ? getItemsForTrigger(snap.trigger) : [];

  return (
    <DropdownMenu
      open={isOpen && items.length > 0}
      onOpenChange={(open) => {
        if (open) return;
        inlineMenuState.closeInlineMenu();
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          ref={triggerRef}
          style={{
            position: 'fixed',
            top: snap.coords?.bottom ?? 0,
            left: snap.coords?.left ?? 0,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={0}
        disablePortal
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={handleMenuKeyDown}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => {
                const { contentId, from } = inlineMenuState;
                if (!contentId) return;
                const editor = $content
                  .valueOrThrow()
                  .files.get(contentId)?.editor;
                if (!editor) return;
                item.onSelect({
                  editor,
                  from,
                  contentId,
                  close: () => inlineMenuState.closeInlineMenu(),
                });
              }}
            >
              {Icon && <Icon />}
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
