import type { NotationDefinition } from '../../notation';
import { inlineAttributesNotation } from './attributes';
import { imageAltNotation } from './figures';
import { footnoteDefinitionNotation } from './footnote-definitions';
import { type FootnoteOptions, footnoteNotations } from './footnotes';
import { headingAttributesNotation, sectionEndNotation } from './headings';
import { mathNotation } from './math';
import { paragraphContinuationNotation } from './paragraphs';
import { rubyNotation } from './ruby';
import { taskListNotation } from './task-list';
import { tableOfContentsNotation } from './toc';

/**
 * Where versions of VFM read the same markdown differently. VFM after 2
 * also nests ruby (`{{a|b}|c}`) and lets emphasis touch CJK punctuation;
 * neither is supported yet.
 */
export interface VfmSyntax extends FootnoteOptions {
  /** `~a~` is strikethrough, as GFM reads it. VFM 2 reads only `~~a~~`. */
  singleTildeStrikethrough: boolean;
  /**
   * An image's alt text, and so a figure's caption, is its description as
   * written, as VFM 2 reads it. CommonMark, and VFM after 2, read its text.
   */
  imageAltSource: boolean;
}

/** VFM 2.7, as `@vivliostyle/vfm` 2.7 reads markdown. */
export const VFM_2_SYNTAX: VfmSyntax = {
  singleTildeStrikethrough: false,
  imageAltSource: true,
  undefinedReferences: true,
  emptyInlineNotes: true,
};

/** The syntax VFM adds to CommonMark and GFM. */
export function vfmNotations(
  syntax: VfmSyntax = VFM_2_SYNTAX,
): NotationDefinition[] {
  return [
    // Headings that VFM 2 reads as lines of a paragraph have no attributes.
    paragraphContinuationNotation,
    headingAttributesNotation,
    sectionEndNotation,
    tableOfContentsNotation,
    taskListNotation,
    ...(syntax.imageAltSource ? [imageAltNotation] : []),
    rubyNotation,
    mathNotation,
    ...footnoteNotations(syntax),
    footnoteDefinitionNotation,
    // micromark tries the syntax of later extensions first: attributes
    // after an element take its `{` before ruby can.
    inlineAttributesNotation,
  ];
}

export {
  formatAttributes,
  type InlineAttributes,
  isAttributeName,
  isRenderedAttribute,
  parseAttributes,
  renderedAttributes,
  writableAttributes,
} from './attributes';
export { type FoundNode, findSelectedInline } from './commands';
export { imageLabel } from './figures';
export {
  type FootnoteStatus,
  footnoteIdentifier,
  footnoteStatus,
} from './footnote-definitions';
export { isWritableFootnoteLabel } from './footnotes';
export {
  codeBlockAttributes,
  codeBlockId,
  type DocumentId,
  documentIds,
  headingText,
  sectionEnds,
} from './headings';
export { isWritableMath } from './math';
export { isWritableRubyText } from './ruby';
export { Slugger, slug } from './slug';
