import { Extension } from '@tiptap/core';

import { toVfm } from './io';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    vfm: {
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
      exportVfm:
        ({ onExport } = {}) =>
        ({ state, editor }) => {
          onExport?.(toVfm(state.doc, editor.schema));
          return true;
        },
    };
  },
});
