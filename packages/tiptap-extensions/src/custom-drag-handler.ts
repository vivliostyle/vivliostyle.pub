import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const CUSTOM_DRAG_MIME_NAME = 'application/x-vivliostyle-pub';

export interface AssetDragPayload {
  type: 'asset';
  path: string;
  category: string;
}

// Add new payload variants to this union as new in-app drag sources appear.
export type CustomDragPayload = AssetDragPayload;

export function parseCustomDragPayload(data: string): CustomDragPayload | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.type === 'string') {
      return parsed as CustomDragPayload;
    }
  } catch {
    // ignore
  }
  return null;
}

export function serializeCustomDragPayload(payload: CustomDragPayload): string {
  return JSON.stringify(payload);
}

export interface CustomDragHandlerOptions {
  onDrop?: (editor: Editor, payload: CustomDragPayload, pos: number) => void;
}

export const CustomDragHandler = Extension.create<CustomDragHandlerOptions>({
  name: 'customDragHandler',

  addOptions() {
    return {};
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { onDrop } = this.options;
    if (!onDrop) {
      return [];
    }
    return [
      new Plugin({
        key: new PluginKey('customDragHandler'),
        props: {
          handleDrop(view, event) {
            const dt = (event as DragEvent).dataTransfer;
            const data = dt?.getData(CUSTOM_DRAG_MIME_NAME);
            if (!data) return false;
            const payload = parseCustomDragPayload(data);
            if (!payload) return false;
            event.preventDefault();
            event.stopPropagation();
            const dropPos = view.posAtCoords({
              left: (event as DragEvent).clientX,
              top: (event as DragEvent).clientY,
            });
            const pos = dropPos?.pos ?? view.state.doc.content.size;
            onDrop(editor, payload, pos);
            return true;
          },
        },
      }),
    ];
  },
});
