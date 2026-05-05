import { type Editor, Extension, mergeAttributes } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { BulletList } from '@tiptap/extension-bullet-list';
import { Code } from '@tiptap/extension-code';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Image } from '@tiptap/extension-image';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Strike } from '@tiptap/extension-strike';
import { Text } from '@tiptap/extension-text';
import { Underline } from '@tiptap/extension-underline';
import { Dropcursor, Gapcursor } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { join } from 'pathe';

import { FileMediaHandler } from './file-media-handler';

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

export interface PubExtensionConfig {
  basePath?: string | undefined;
  onFileDrop?: (editor: Editor, files: File[], pos: number) => void;
  onFilePaste?: (editor: Editor, files: File[]) => void;
}

declare module '@tiptap/core' {
  interface Storage {
    image: {
      basePath?: string | undefined;
    };
  }
}

export const PubExtensions = Extension.create<PubExtensionConfig>({
  name: 'pubExtensions',

  addExtensions() {
    const { basePath, onFileDrop, onFilePaste } = this.options;

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

      FileMediaHandler.configure({
        allowedMimeTypes: IMAGE_MIME_TYPES,
        onDrop: onFileDrop,
        onPaste: onFilePaste,
      }),
      Image.extend({
        addStorage() {
          return { basePath };
        },
        renderHTML({ HTMLAttributes }) {
          const { src, ...rest } = HTMLAttributes;
          let resolvedSrc = src;
          if (src && !/^(https?:)?\/\//.test(src)) {
            resolvedSrc = join(
              '/vivliostyle',
              this.storage.basePath ?? '',
              src,
            );
          }
          return [
            'img',
            mergeAttributes(this.options.HTMLAttributes, {
              ...rest,
              src: resolvedSrc,
            }),
          ];
        },
      }).configure({}),
      Markdown.configure({}),
    ];
  },
});
