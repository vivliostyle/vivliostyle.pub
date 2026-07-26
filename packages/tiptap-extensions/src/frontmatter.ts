import { Extension } from '@tiptap/core';

const FRONTMATTER_RE =
  /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:(?:\r?\n)+|$)/;

/**
 * Consumes a leading YAML frontmatter block as a single token so marked does
 * not misread it as a thematic break followed by a setext heading. No
 * `parseMarkdown` handler is registered, so the token produces no editor node
 * and the frontmatter is dropped from the document.
 */
export const Frontmatter = Extension.create({
  name: 'frontmatter',

  markdownTokenizer: {
    name: 'frontmatter',
    level: 'block',
    // Frontmatter can never start mid-document, so it must not take part in
    // marked's paragraph-interruption checks.
    start: () => -1,
    tokenize(src, tokens) {
      // tokens accumulates previously lexed blocks, so a non-empty array means
      // we are past the start of the document (or of a nested block).
      if (tokens.length > 0) {
        return undefined;
      }
      const match = src.match(FRONTMATTER_RE);
      if (!match) {
        return undefined;
      }
      return { type: 'frontmatter', raw: match[0] };
    },
  },
});
