import { Extension, isMacOS, isiOS } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineBreak: {
      deleteBeforeNewLine: () => ReturnType;
      deleteAfterNewLine: () => ReturnType;
      insertNewLine: () => ReturnType;
    };
  }
}

export const LineBreak = Extension.create({
  name: 'lineBreak',

  addCommands() {
    return {
      deleteBeforeNewLine:
        () =>
        ({ tr, chain, editor }) => {
          const { selection } = tr;
          const { $from } = selection;
          if (!editor.can().joinBackward()) {
            return false;
          }
          const before = tr.doc.resolve($from.before($from.depth)).nodeBefore;

          let commands = chain();
          commands = commands.joinBackward();
          if (
            before &&
            before.childCount > 0 &&
            before.type.name === 'paragraph'
          ) {
            // If the node before the selection is not empty paragraph,
            // set a hard break before the selection.
            commands = commands.setHardBreak().setTextSelection($from.pos - 1);
          }
          return commands.run();
        },
      deleteAfterNewLine:
        () =>
        ({ tr, chain, editor }) => {
          const { selection } = tr;
          const { $from } = selection;
          if (!editor.can().joinForward()) {
            return false;
          }
          const current = $from.parent;

          let commands = chain();
          commands = commands.joinForward();
          if (current.childCount > 0 && current.type.name === 'paragraph') {
            // If the selecting node is not empty paragraph,
            // set a hard break after the selection.
            commands = commands.setHardBreak().setTextSelection($from.pos);
          }
          return commands.run();
        },
      insertNewLine:
        () =>
        ({ commands, tr, chain }) => {
          const { selection } = tr;
          const { $from, $to } = selection;
          if ($from.parent.type.name !== 'paragraph') {
            return commands.splitBlock();
          }

          const hasBeforeHardBreak =
            $from.nodeBefore?.type.name === 'hardBreak';
          const hasAfterHardBreak = $to.nodeAfter?.type.name === 'hardBreak';
          const isAtStartOfBlock = $from.parentOffset === 0;

          if (hasBeforeHardBreak || hasAfterHardBreak || isAtStartOfBlock) {
            return (
              chain()
                // If there is a hard break before or after the selection,
                // delete the hard breaks and split the block.
                .deleteRange({
                  from: hasBeforeHardBreak ? $from.pos - 1 : $from.pos,
                  to: hasAfterHardBreak ? $to.pos + 1 : $to.pos,
                })
                .splitBlock()
                .run()
            );
          }
          return commands.setHardBreak();
        },
    };
  },

  addKeyboardShortcuts() {
    const handleBackspace = () =>
      this.editor.commands.first(({ commands }) => [
        () => commands.deleteBeforeNewLine(),
      ]);

    const handleDelete = () =>
      this.editor.commands.first(({ commands }) => [
        () => commands.deleteAfterNewLine(),
      ]);

    const handleEnter = () =>
      this.editor.commands.first(({ commands }) => [
        () => commands.newlineInCode(),
        () => commands.createParagraphNear(),
        () => commands.liftEmptyBlock(),
        () => commands.insertNewLine(),
      ]);

    const baseKeymap = {
      Enter: handleEnter,
      Backspace: handleBackspace,
      'Mod-Backspace': handleBackspace,
      'Shift-Backspace': handleBackspace,
      Delete: handleDelete,
      'Mod-Delete': handleDelete,
    };
    if (isiOS() || isMacOS()) {
      const macKeymap = {
        ...baseKeymap,
        'Ctrl-h': handleBackspace,
        'Alt-Backspace': handleBackspace,
        'Ctrl-d': handleDelete,
        'Ctrl-Alt-Backspace': handleDelete,
        'Alt-Delete': handleDelete,
        'Alt-d': handleDelete,
      };
      return macKeymap;
    }
    return baseKeymap;
  },
});
