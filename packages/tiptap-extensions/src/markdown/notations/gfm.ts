import { Strike } from '@tiptap/extension-strike';
import { Underline } from '@tiptap/extension-underline';
import remarkGfm from 'remark-gfm';

import {
  declareNotation,
  defineNotation,
  type NotationDefinition,
} from '../notation';

// VFM renders strikethrough as `del`, which themes style.
const PubStrike = Strike.extend({
  renderHTML({ HTMLAttributes }) {
    return ['del', HTMLAttributes, 0];
  },
});

/**
 * GitHub Flavored Markdown as VFM reads it. Tables have no definition yet
 * and are kept as raw markdown; task lists and footnote definitions are
 * the VFM bundle's.
 */
export function gfmNotations({
  singleTilde,
}: {
  /** `~a~` is strikethrough as well as `~~a~~`. */
  singleTilde: boolean;
}): NotationDefinition[] {
  const gfm = (version: number, single: boolean) =>
    defineNotation({
      name: 'gfm',
      version,
      remarkPlugins: [[remarkGfm, { singleTilde: single }]],
      // A row of cells needs pipes. Text that GFM autolinks cannot be escaped
      // out of it: the links are found in the text after escapes are read.
      escapes: [{ pattern: /\|/g }],
    });
  return [
    // Version 1 read `~a~` as strikethrough.
    singleTilde ? gfm(1, true) : { ...gfm(2, false), earlier: [gfm(1, true)] },
    declareNotation(
      {
        kind: 'delimitedMark',
        name: 'strikethrough',
        mark: 'strike',
        mdastType: 'delete',
        delimiter: '~~',
        tag: 'del',
      },
      [PubStrike],
    ),
  ];
}

/** HTML elements that markdown has no syntax for, written as tags. */
export const htmlMarkNotations: NotationDefinition[] = [
  declareNotation(
    { kind: 'htmlMark', name: 'underline', mark: 'underline', tag: 'u' },
    [Underline],
  ),
];
