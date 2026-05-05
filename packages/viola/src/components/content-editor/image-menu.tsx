import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useCurrentEditor } from '@tiptap/react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@v/ui/button';
import { Trash2 } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { useContainerRelativeRect } from '../../hooks/use-container-relative-rect';

const IMAGE_MENU_OFFSET_VAR = '--image-menu-offset';

interface ImageState {
  from: number;
  to: number;
  alt: string;
}

interface ImageMenuProps {
  containerRef: RefObject<HTMLDivElement | null>;
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

export function ImageMenu({ containerRef }: ImageMenuProps) {
  const { editor } = useCurrentEditor();
  const [state, setState] = useState<ImageState | null>(null);
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

  // Resolve the actual image DOM node so the shared hook can measure it
  // (and re-measure via ResizeObserver on async image load).
  const imageDom = useMemo(() => {
    if (!editor || !state) return null;
    const dom = editor.view.nodeDOM(state.from);
    return dom instanceof HTMLElement ? dom : null;
  }, [editor, state]);
  const rect = useContainerRelativeRect(containerRef, imageDom);

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
    editor
      .chain()
      .updateAttributes('image', { alt: value })
      .setNodeSelection(state.from)
      .run();
  }, [editor, state]);

  const handleDelete = useCallback(() => {
    if (!editor) {
      return;
    }
    editor.chain().focus().deleteSelection().run();
  }, [editor]);

  if (!editor || !state || !rect) {
    return null;
  }

  return (
    <div
      style={
        {
          position: 'absolute',
          top: rect.top,
          left: rect.left,
          width: rect.width,
          pointerEvents: 'none',
          zIndex: 50,
          textAlign: 'center',
          [IMAGE_MENU_OFFSET_VAR]: '4px',
        } as React.CSSProperties
      }
    >
      {/* Spacer matching the image height so the sticky menu naturally
          settles at the image's bottom edge. */}
      <div style={{ height: rect.height, pointerEvents: 'none' }} aria-hidden />
      {/* Sticky menu sticks to the viewport bottom while the image is
          partially scrolled past, then settles back below the image. */}
      <div
        role="toolbar"
        aria-label="Image actions"
        style={{
          position: 'sticky',
          bottom: `var(${IMAGE_MENU_OFFSET_VAR})`,
          marginTop: `var(${IMAGE_MENU_OFFSET_VAR})`,
          pointerEvents: 'auto',
        }}
        className="inline-flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
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
          variant="destructive"
          className="h-7 w-7"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleDelete}
          aria-label="Delete image"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
