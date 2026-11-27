import { type Editor, Extension } from '@tiptap/core';
import { Dropcursor, Gapcursor } from '@tiptap/extensions';

import { BlockFormatting } from './block-format';
import { ChainSafeClearNodes } from './clear-nodes';
import {
  CustomDragHandler,
  type CustomDragPayload,
} from './custom-drag-handler';
import { FileMediaHandler } from './file-media-handler';
import { imageExtensions } from './images';
import { HtmlElementCommands } from './markdown/declare';
import { PubMarkdown, type PubMarkdownOptions } from './markdown/extension';
import type { NotationDefinition } from './markdown/notation';
import { commonMarkNotations } from './markdown/notations/commonmark';
import { gfmNotations, htmlMarkNotations } from './markdown/notations/gfm';
import { themeBaseElementNotations } from './markdown/notations/html-elements/theme-base';
import { allThemeElementNotations } from './markdown/notations/html-elements/themes';
import { rawNotation } from './markdown/notations/raw';
import {
  VFM_2_SYNTAX,
  type VfmSyntax,
  vfmNotations,
} from './markdown/notations/vfm/notations';

export { type BlockFormat, getBlockFormat } from './block-format';
export {
  codeBlockCaption,
  findSelectedCodeBlock,
  listHighlightLanguages,
  resolveVfmLanguage,
  withCodeBlockCaption,
} from './code-block-prism';
export {
  type AssetDragPayload,
  CUSTOM_DRAG_MIME_NAME,
  type CustomDragPayload,
  parseCustomDragPayload,
  serializeCustomDragPayload,
} from './custom-drag-handler';
export {
  type DeclaredElement,
  declaredElementOf,
  OTHER_ATTRIBUTES,
} from './markdown/declare';
export {
  currentNotations,
  type DocumentRecord,
  getMarkdown,
  hasDocumentNotation,
  parseMarkdown,
  setDocumentNotations,
  setMarkdownBaseline,
  upgradeDocumentNotations,
} from './markdown/extension';
export type { NotationDefinition } from './markdown/notation';
export {
  CROSS_REFERENCE,
  knownIds,
  referencedId,
} from './markdown/notations/html-elements/cross-reference';
export {
  formatAttributes,
  type InlineAttributes,
  isAttributeName,
  isRenderedAttribute,
  parseAttributes,
  writableAttributes,
} from './markdown/notations/vfm/attributes';
export {
  type FoundNode,
  findSelectedInline,
} from './markdown/notations/vfm/commands';
export {
  footnoteIdentifier,
  footnoteStatus,
} from './markdown/notations/vfm/footnote-definitions';
export { isWritableFootnoteLabel } from './markdown/notations/vfm/footnotes';
export {
  codeBlockAttributes,
  type DocumentId,
  documentIds,
  headingText,
  sectionEnds,
} from './markdown/notations/vfm/headings';
export { isWritableMath } from './markdown/notations/vfm/math';
export {
  type MathTypesetter,
  MathTypesetting,
  type TypesetMath,
} from './markdown/notations/vfm/math-view';
export {
  VFM_2_SYNTAX,
  type VfmSyntax,
} from './markdown/notations/vfm/notations';
export { isWritableRubyText } from './markdown/notations/vfm/ruby';
export { slug } from './markdown/notations/vfm/slug';
export { MarkdownWriteError } from './markdown/write';

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

    const { image, inlineImage } = imageExtensions(basePath);

    return [
      // The schema comes from the notation definitions.
      PubMarkdown.configure({
        notations: [
          ...commonMarkNotations({ image, inlineImage }),
          ...gfmNotations({ singleTilde: vfm.singleTildeStrikethrough }),
          ...htmlMarkNotations,
          ...vfmNotations(vfm),
          ...themeBaseElementNotations,
          ...allThemeElementNotations(),
          rawNotation,
          ...(this.options.notations ?? []),
        ],
        documentRecord: this.options.documentRecord,
        onSetMarkdown: this.options.onSetMarkdown,
      }),
      HtmlElementCommands,
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
