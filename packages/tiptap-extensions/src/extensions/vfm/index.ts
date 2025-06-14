import { Extension } from '@tiptap/core';
import type { Node } from 'prosemirror-model';

import { fromVfm, toVfm } from './io';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    vfm: {
      importVfm: (_: {
        markdown: string;
        onImport?: (_: { content: Node }) => void;
      }) => ReturnType;
      /**
       * Export the VFM content.
       */
      exportVfm: (_?: { onExport?: (vfm: string) => void }) => ReturnType;
    };
  }
}

export const Vfm = Extension.create({
  name: 'vfm',

  addCommands() {
    return {
      importVfm:
        ({ markdown, onImport }) =>
        ({ state, editor }) => {
          onImport?.({ content: fromVfm(markdown, editor.schema) });
          return true;
        },
      exportVfm:
        ({ onExport } = {}) =>
        ({ state, editor }) => {
          console.log(state.doc);
          onExport?.(toVfm(state.doc, editor.schema));
          return true;
        },
    };
  },
});
