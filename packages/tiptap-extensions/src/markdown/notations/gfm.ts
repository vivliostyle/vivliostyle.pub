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
 * GitHub Flavored Markdown as VFM reads it. Tables, task list checkboxes and
 * footnote definitions have no definition yet and are kept as raw markdown.
 */
export function gfmNotations({
  singleTilde,
}: {
  /** `~a~` is strikethrough as well as `~~a~~`. */
  singleTilde: boolean;
}): NotationDefinition[] {
  return [
    defineNotation({
      name: 'gfm',
      version: 2,
      remarkPlugins: [[remarkGfm, { singleTilde }]],
      escapes: [
        // A row of cells needs pipes, and text would otherwise autolink.
        { pattern: /\|/g },
        { pattern: /(?<=\b(?:https?|ftp)):(?=\/\/)/gi },
        { pattern: /(?<=\bwww)\./gi },
        { pattern: /@/g },
      ],
    }),
    declareNotation(
      {
        kind: 'delimitedMark',
        name: 'strikethrough',
        mark: 'strike',
        mdastType: 'delete',
        delimiter: '~~',
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
