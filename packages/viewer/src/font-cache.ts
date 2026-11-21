import type { CoreViewer } from '@vivliostyle/core';

// Core's font mapper adds one `<style>` per web font it loads, holding an
// `@font-face` rule for a family it names itself, and never removes it.
const viewFontFaceRule = /^@font-face\s*\{\s*font-family:\s*Fnt_\d+;/;

export function isViewFontFaceRule(cssText: string): boolean {
  return viewFontFaceRule.test(cssText);
}

export function viewFontStyles(document: Document): HTMLStyleElement[] {
  return Array.from(document.head.getElementsByTagName('style')).filter(
    (style) => isViewFontFaceRule(style.textContent ?? ''),
  );
}

interface FontMapper {
  srcURLMap: Record<string, unknown>;
}

/**
 * Empties the cache through which core reuses the fonts it loaded for earlier
 * loads, keyed by family, `src` and descriptors. The fonts loaded next get
 * families of new names, so the rules of the old ones can stay in place for
 * the pages laid out with them. Not part of core's API: false, and nothing
 * done, when core's internals are not as expected.
 */
export function dropFontCache(viewer: CoreViewer): boolean {
  const mapper = (
    viewer as unknown as { adaptViewer_?: { fontMapper?: Partial<FontMapper> } }
  ).adaptViewer_?.fontMapper;
  if (
    !mapper ||
    typeof mapper.srcURLMap !== 'object' ||
    mapper.srcURLMap === null
  ) {
    console.warn('Cannot drop the font cache of @vivliostyle/core');
    return false;
  }
  mapper.srcURLMap = {};
  return true;
}
