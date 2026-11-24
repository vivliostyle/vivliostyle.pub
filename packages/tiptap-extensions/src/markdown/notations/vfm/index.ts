import type { NotationDefinition } from '../../notation';
import { inlineAttributesNotation } from './attributes';
import { type FootnoteOptions, footnoteNotations } from './footnotes';
import { mathNotation } from './math';
import { rubyNotation } from './ruby';

/**
 * Where versions of VFM read the same markdown differently. VFM after 2
 * also nests ruby (`{{a|b}|c}`) and lets emphasis touch CJK punctuation;
 * neither is supported yet.
 */
export interface VfmSyntax extends FootnoteOptions {
  /** `~a~` is strikethrough, as GFM reads it. VFM 2 reads only `~~a~~`. */
  singleTildeStrikethrough: boolean;
}

/** VFM 2.7, as `@vivliostyle/vfm` 2.7 reads markdown. */
export const VFM_2_SYNTAX: VfmSyntax = {
  singleTildeStrikethrough: false,
  undefinedReferences: true,
  emptyInlineNotes: true,
};

/** The inline syntax VFM adds to CommonMark and GFM. */
export function vfmNotations(
  syntax: VfmSyntax = VFM_2_SYNTAX,
): NotationDefinition[] {
  return [
    rubyNotation,
    mathNotation,
    ...footnoteNotations(syntax),
    // micromark tries the syntax of later extensions first: attributes
    // after an element take its `{` before ruby can.
    inlineAttributesNotation,
  ];
}

export {
  formatAttributes,
  type InlineAttributes,
  parseAttributes,
} from './attributes';
export { type FoundNode, findSelectedInline } from './commands';
export { isWritableFootnoteLabel } from './footnotes';
export { isWritableMath } from './math';
export { isWritableRubyText } from './ruby';
