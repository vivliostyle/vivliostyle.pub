import { Extension } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { BulletList } from '@tiptap/extension-bullet-list';
import { Code } from '@tiptap/extension-code';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Strike } from '@tiptap/extension-strike';
import { Text } from '@tiptap/extension-text';
import { Underline } from '@tiptap/extension-underline';
import { Dropcursor, Gapcursor } from '@tiptap/extensions';

import { Vfm } from './extensions/vfm';

export const PubExtensions = Extension.create({
  name: 'pubExtensions',

  addExtensions() {
    return [
      // Starter kit extensions
      Bold.configure({}),
      Blockquote.configure({}),
      BulletList.configure({}),
      Code.configure({}),
      CodeBlock.configure({}),
      Document.configure({}),
      Dropcursor.configure({}),
      Gapcursor.configure({}),
      HardBreak.configure({}),
      Heading.configure({}),
      // UndoRedo.configure({}),
      HorizontalRule.configure({}),
      Italic.configure({}),
      ListItem.configure({}),
      ListKeymap.configure({}),
      Link.configure({}),
      OrderedList.configure({}),
      Paragraph.configure({}),
      Strike.configure({}),
      Text.configure({}),
      Underline.configure({}),
      // TrailingNode.configure({}),

      Vfm.configure({}),
    ];
  },
});
