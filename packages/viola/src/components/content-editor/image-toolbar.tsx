import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useCurrentEditor } from '@tiptap/react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@v/ui/button';
import { Trash2 } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { m } from '../../generated/paraglide/messages';
import { useContainerRelativeRect } from '../../hooks/use-container-relative-rect';

const IMAGE_TOOLBAR_OFFSET_VAR = '--image-toolbar-offset';

interface ImageState {
  from: number;
  to: number;
  /** A figure, or an image in text. */
  type: 'image' | 'inlineImage';
  alt: string;
  src: string;
}

interface ImageToolbarProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

function getSelectedImage(editor: Editor): ImageState | null {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection)) {
    return null;
  }
  const type = sel.node.type.name;
  if (type !== 'image' && type !== 'inlineImage') {
    return null;
  }
  const { alt, src } = sel.node.attrs;
  return {
    from: sel.from,
    to: sel.to,
    type,
    alt: typeof alt === 'string' ? alt : '',
    src: typeof src === 'string' ? src : '',
  };
}

export function ImageToolbar({ containerRef }: ImageToolbarProps) {
  const { editor } = useCurrentEditor();
  const [state, setState] = useState<ImageState | null>(null);
  const altInputRef = useRef<HTMLInputElement>(null);
  const srcInputRef = useRef<HTMLInputElement>(null);

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

  const handleBlur = useCallback(
    (name: 'alt' | 'src') => {
      const input = name === 'alt' ? altInputRef.current : srcInputRef.current;
      if (!editor || !input || !state) {
        return;
      }
      const { value } = input;
      const current = getSelectedImage(editor);
      if (
        !current ||
        current.from !== state.from ||
        current.to !== state.to ||
        current[name] === value ||
        (name === 'src' && !value)
      ) {
        return;
      }
      editor
        .chain()
        .updateAttributes(current.type, { [name]: value })
        .setNodeSelection(state.from)
        .run();
    },
    [editor, state],
  );

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
          [IMAGE_TOOLBAR_OFFSET_VAR]: '4px',
        } as React.CSSProperties
      }
    >
      {/* Spacer matching the image height so the sticky toolbar naturally
          settles at the image's bottom edge. */}
      <div style={{ height: rect.height, pointerEvents: 'none' }} aria-hidden />
      {/* Sticky toolbar sticks to the viewport bottom while the image is
          partially scrolled past, then settles back below the image. */}
      <div
        role="toolbar"
        aria-label={m.image_toolbar_aria()}
        style={{
          position: 'sticky',
          bottom: `var(${IMAGE_TOOLBAR_OFFSET_VAR})`,
          marginTop: `var(${IMAGE_TOOLBAR_OFFSET_VAR})`,
          pointerEvents: 'auto',
        }}
        className="inline-flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
      >
        <Input
          key={`alt-${state.from}-${state.to}`}
          ref={altInputRef}
          defaultValue={state.alt}
          onBlur={() => handleBlur('alt')}
          placeholder={
            state.type === 'image'
              ? m.image_toolbar_alt_placeholder()
              : m.image_toolbar_inline_alt_placeholder()
          }
          className="h-7 w-48"
          aria-label={
            state.type === 'image'
              ? m.image_toolbar_alt_aria()
              : m.image_toolbar_inline_alt_aria()
          }
        />
        <Input
          key={`src-${state.from}-${state.to}`}
          ref={srcInputRef}
          defaultValue={state.src}
          onBlur={() => handleBlur('src')}
          placeholder={m.image_toolbar_src_placeholder()}
          className="h-7 w-48"
          aria-label={m.image_toolbar_src_aria()}
        />
        <Button
          type="button"
          size="icon"
          variant="destructive"
          className="h-7 w-7"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleDelete}
          aria-label={m.image_toolbar_delete_aria()}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
