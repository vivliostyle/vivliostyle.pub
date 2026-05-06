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

import {
  CustomDragHandler,
  type CustomDragPayload,
} from './custom-drag-handler';
import { FileMediaHandler } from './file-media-handler';

export {
  type AssetDragPayload,
  CUSTOM_DRAG_MIME_NAME,
  type CustomDragPayload,
  parseCustomDragPayload,
  serializeCustomDragPayload,
} from './custom-drag-handler';

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

export interface ImageSaver {
  saveImage(file: File): Promise<{ src: string }>;
}

export interface PubExtensionConfig {
  basePath?: string | undefined;
  fileDir?: string | undefined;
  imageSaver?: ImageSaver | undefined;
  onFileDrop?: (editor: Editor, files: File[], pos: number) => void;
  onFilePaste?: (editor: Editor, files: File[]) => void;
  onDrop?: (editor: Editor, payload: CustomDragPayload, pos: number) => void;
}

declare module '@tiptap/core' {
  interface Storage {
    image: {
      basePath?: string | undefined;
    };
    pubExtensions: {
      fileDir?: string | undefined;
      imageSaver?: ImageSaver | undefined;
    };
  }
}

// Matches absolute URLs that should bypass the in-app /vivliostyle/* prefix:
// any explicit scheme (http:, https:, blob:, data:, file:, ...) or a
// protocol-relative URL.
const ABSOLUTE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export const PubExtensions = Extension.create<PubExtensionConfig>({
  name: 'pubExtensions',

  addStorage() {
    return {
      fileDir: this.options.fileDir,
      imageSaver: this.options.imageSaver,
    };
  },

  addExtensions() {
    const { basePath, onFileDrop, onFilePaste, onDrop } = this.options;

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
      CustomDragHandler.configure({ onDrop }),
      Image.extend({
        addStorage() {
          return { basePath };
        },
        renderHTML({ HTMLAttributes }) {
          const { src, ...rest } = HTMLAttributes;
          let resolvedSrc = src;
          if (src && !ABSOLUTE_URL_RE.test(src)) {
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
