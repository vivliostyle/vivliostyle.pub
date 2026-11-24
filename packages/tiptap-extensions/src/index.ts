import { type Editor, Extension, mergeAttributes } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { Dropcursor, Gapcursor } from '@tiptap/extensions';
import { join } from 'pathe';

import { BlockFormatting } from './block-format';
import { ChainSafeClearNodes } from './clear-nodes';
import {
  CustomDragHandler,
  type CustomDragPayload,
} from './custom-drag-handler';
import { FileMediaHandler } from './file-media-handler';
import {
  commonMarkNotations,
  gfmNotations,
  htmlMarkNotations,
  type NotationDefinition,
  PubMarkdown,
  type PubMarkdownOptions,
  rawNotation,
  VFM_2_SYNTAX,
  type VfmSyntax,
  vfmNotations,
} from './markdown';

export { type BlockFormat, getBlockFormat } from './block-format';
export {
  findSelectedCodeBlock,
  listHighlightLanguages,
  resolveVfmLanguage,
} from './code-block-prism';
export {
  type AssetDragPayload,
  CUSTOM_DRAG_MIME_NAME,
  type CustomDragPayload,
  parseCustomDragPayload,
  serializeCustomDragPayload,
} from './custom-drag-handler';
export {
  currentNotations,
  type DocumentRecord,
  type FoundNode,
  findSelectedInline,
  formatAttributes,
  getMarkdown,
  type InlineAttributes,
  isWritableFootnoteLabel,
  isWritableMath,
  isWritableRubyText,
  MARKED_NOTATIONS,
  MarkdownWriteError,
  type NotationDefinition,
  parseAttributes,
  parseMarkdown,
  setDocumentNotations,
  setMarkdownBaseline,
  upgradeDocumentNotations,
  VFM_2_SYNTAX,
  type VfmSyntax,
} from './markdown';

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
  /** Called after markdown has replaced the whole document. */
  onSetMarkdown?: (editor: Editor) => void;
  /** See `PubMarkdownOptions.documentRecord`. */
  documentRecord?: PubMarkdownOptions['documentRecord'];
  /** How the VFM version the project is built with reads markdown. */
  vfm?: VfmSyntax | undefined;
  /** Syntax added on top of CommonMark, GFM and VFM. */
  notations?: NotationDefinition[];
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

// The definitions in use when the editor moved from marked to remark. Kept
// as a fixed list: documents made with marked are written with these.
const MARKED_ERA_NOTATIONS = [
  'document',
  'paragraph',
  'heading',
  'thematicBreak',
  'blockquote',
  'list',
  'codeBlock',
  'hardBreak',
  'image',
  'emphasis',
  'strong',
  'inlineCode',
  'link',
  'gfm',
  'strikethrough',
  'underline',
  'raw',
];

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
    const vfm = this.options.vfm ?? VFM_2_SYNTAX;

    const image = Image.extend({
      addStorage() {
        return { basePath };
      },
      renderHTML({ HTMLAttributes }) {
        const { src, ...rest } = HTMLAttributes;
        let resolvedSrc = src;
        if (src && !ABSOLUTE_URL_RE.test(src)) {
          resolvedSrc = join('/vivliostyle', this.storage.basePath ?? '', src);
        }
        return [
          'img',
          mergeAttributes(this.options.HTMLAttributes, {
            ...rest,
            src: resolvedSrc,
          }),
        ];
      },
    }).configure({});

    return [
      // The schema comes from the notation definitions.
      PubMarkdown.configure({
        notations: [
          ...commonMarkNotations({ image }),
          ...gfmNotations({ singleTilde: vfm.singleTildeStrikethrough }),
          ...htmlMarkNotations,
          ...vfmNotations(vfm),
          rawNotation,
          ...(this.options.notations ?? []),
        ],
        markedEraNotations: MARKED_ERA_NOTATIONS,
        documentRecord: this.options.documentRecord,
        onSetMarkdown: this.options.onSetMarkdown,
      }),
      Dropcursor.configure({}),
      Gapcursor.configure({}),
      ChainSafeClearNodes,
      BlockFormatting,
      FileMediaHandler.configure({
        allowedMimeTypes: IMAGE_MIME_TYPES,
        onDrop: onFileDrop,
        onPaste: onFilePaste,
      }),
      CustomDragHandler.configure({ onDrop }),
    ];
  },
});
