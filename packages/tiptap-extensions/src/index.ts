import { Extension } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { BulletList } from '@tiptap/extension-bullet-list';
import { Code } from '@tiptap/extension-code';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { Dropcursor } from '@tiptap/extension-dropcursor';
import { Gapcursor } from '@tiptap/extension-gapcursor';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { ListItem } from '@tiptap/extension-list-item';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Strike } from '@tiptap/extension-strike';
import { Text } from '@tiptap/extension-text';

import { LineBreak } from './extensions/line-break';
import { Vfm } from './extensions/vfm';

export const PubExtensions = Extension.create<PubExtensionsOptions>({
  name: 'pubExtensions',

  addExtensions() {
    return [
      // Override core extensions
      LineBreak.configure(),

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
      // History.configure({}),
      HorizontalRule.configure({}),
      Italic.configure({}),
      ListItem.configure({}),
      OrderedList.configure({}),
      Paragraph.configure({}),
      Strike.configure({}),
      Text.configure({}),

      Vfm.configure({}),
    ];
  },
});
