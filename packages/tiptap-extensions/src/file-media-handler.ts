import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface FileMediaHandlerOptions {
  allowedMimeTypes?: string[];
  onDrop?: (editor: Editor, files: File[], pos: number) => void;
  onPaste?: (editor: Editor, files: File[]) => void;
}

export const FileMediaHandler = Extension.create<FileMediaHandlerOptions>({
  name: 'fileMediaHandler',

  addOptions() {
    return {};
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { allowedMimeTypes, onDrop, onPaste } = this.options;

    return [
      new Plugin({
        key: new PluginKey('fileMediaHandler'),
        props: {
          handleDrop(view, event) {
            if (!onDrop) {
              return false;
            }
            const dt = (event as DragEvent).dataTransfer;
            let files = Array.from(dt?.files ?? []);
            if (allowedMimeTypes) {
              files = files.filter((f) => allowedMimeTypes.includes(f.type));
            }
            if (files.length === 0) {
              return false;
            }
            event.preventDefault();
            event.stopPropagation();
            const dropPos = view.posAtCoords({
              left: (event as DragEvent).clientX,
              top: (event as DragEvent).clientY,
            });
            const pos = dropPos?.pos ?? view.state.doc.content.size;
            onDrop(editor, files, pos);
            return true;
          },
          handlePaste(_view, event) {
            if (!onPaste) {
              return false;
            }
            const cb = (event as ClipboardEvent).clipboardData;
            let files = Array.from(cb?.files ?? []);
            if (allowedMimeTypes) {
              files = files.filter((f) => allowedMimeTypes.includes(f.type));
            }
            if (files.length === 0) {
              return false;
            }
            event.preventDefault();
            event.stopPropagation();
            onPaste(editor, files);
            return true;
          },
        },
      }),
    ];
  },
});
