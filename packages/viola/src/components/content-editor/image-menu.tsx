import {
  autoUpdate,
  computePosition,
  flip,
  hide,
  offset,
  type VirtualElement,
} from '@floating-ui/react-dom';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useCurrentEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@v/ui/button';
import { Trash2 } from '@v/ui/icon';
import { Input } from '@v/ui/input';

interface ImageState {
  from: number;
  to: number;
  alt: string;
}

function getSelectedImage(editor: Editor): ImageState | null {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection)) {
    return null;
  }
  if (sel.node.type.name !== 'image') {
    return null;
  }
  const alt = sel.node.attrs.alt;
  return {
    from: sel.from,
    to: sel.to,
    alt: typeof alt === 'string' ? alt : '',
  };
}

export function ImageMenu() {
  const { editor } = useCurrentEditor();
  const [state, setState] = useState<ImageState | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const altInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const sync = () => {
      const next = getSelectedImage(editor);
      setState((prev) => {
        if (!next) {
          return prev === null ? prev : null;
        }
        // Preserve the same reference while the user keeps the same image
        // selected. We intentionally do NOT track external `alt` changes
        // here, because the Input is uncontrolled and re-rendering it
        // (or replacing its key) mid-typing would interrupt input/IME.
        if (prev && prev.from === next.from && prev.to === next.to) {
          return prev;
        }
        return next;
      });
    };
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    sync();
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !state || !menuRef.current) {
      setCoords(null);
      return;
    }
    const menuEl = menuRef.current;
    const { from, to } = state;
    const reference: VirtualElement = {
      getBoundingClientRect() {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const top = Math.min(start.top, end.top);
        const bottom = Math.max(start.bottom, end.bottom);
        const left = Math.min(start.left, end.left);
        const right = Math.max(start.right, end.right);
        return {
          top,
          bottom,
          left,
          right,
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          toJSON() {
            return this;
          },
        };
      },
      contextElement: editor.view.dom,
    };
    async function update() {
      const result = await computePosition(reference, menuEl, {
        placement: 'bottom-start',
        middleware: [offset(4), flip(), hide()],
      });
      if (result.middlewareData.hide?.referenceHidden) {
        setCoords(null);
        return;
      }
      setCoords({ top: result.y, left: result.x });
    }
    return autoUpdate(reference, menuEl, update);
  }, [editor, state]);

  const handleAltBlur = useCallback(() => {
    if (!editor || !altInputRef.current || !state) {
      return;
    }
    const value = altInputRef.current.value;
    const current = getSelectedImage(editor);
    if (
      !current ||
      current.from !== state.from ||
      current.to !== state.to ||
      current.alt === value
    ) {
      return;
    }
    editor.chain().updateAttributes('image', { alt: value }).run();
  }, [editor, state]);

  const handleDelete = useCallback(() => {
    if (!editor) {
      return;
    }
    editor.chain().focus().deleteSelection().run();
  }, [editor]);

  if (!editor || !state) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: coords?.top ?? 0,
        left: coords?.left ?? 0,
        visibility: coords ? 'visible' : 'hidden',
        zIndex: 50,
      }}
      className="flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
    >
      <Input
        key={`${state.from}-${state.to}`}
        ref={altInputRef}
        defaultValue={state.alt}
        onBlur={handleAltBlur}
        placeholder="Alt text"
        className="h-7 w-48"
        aria-label="Alt text"
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleDelete}
        aria-label="Delete image"
      >
        <Trash2 />
      </Button>
    </div>
  );
}
