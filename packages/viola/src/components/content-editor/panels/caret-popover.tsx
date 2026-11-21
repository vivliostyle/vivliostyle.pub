import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react-dom';
import { type Editor, posToDOMRect } from '@tiptap/core';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';

export function CaretPopover({
  editor,
  onDismiss,
  children,
}: {
  editor: Editor;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-start',
    strategy: 'absolute',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const floatingRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    refs.setReference({
      // The editor keeps its selection while the panel has focus and maps it
      // through remote edits, so it stays the insertion point.
      getBoundingClientRect: () => {
        const { from, to } = editor.state.selection;
        return posToDOMRect(editor.view, from, to);
      },
      contextElement: editor.view.dom,
    });
  }, [editor, refs]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        floatingRef.current?.contains(event.target)
      ) {
        return;
      }
      onDismiss();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onDismiss]);

  return (
    <div
      ref={(element) => {
        floatingRef.current = element;
        refs.setFloating(element);
      }}
      style={floatingStyles}
      className="z-50 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {children}
    </div>
  );
}
