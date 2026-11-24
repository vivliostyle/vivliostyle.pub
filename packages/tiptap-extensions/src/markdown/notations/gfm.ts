import { Strike } from '@tiptap/extension-strike';
import { Underline } from '@tiptap/extension-underline';
import remarkGfm from 'remark-gfm';

import {
  declareNotation,
  defineNotation,
  type NotationDefinition,
} from '../notation';

/**
 * GitHub Flavored Markdown as VFM reads it. Tables, task list checkboxes and
 * footnotes have no definition yet and are kept as raw markdown.
 */
export const gfmNotations: NotationDefinition[] = [
  defineNotation({
    name: 'gfm',
    remarkPlugins: [remarkGfm],
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
    [Strike],
  ),
];

/** HTML elements that markdown has no syntax for, written as tags. */
export const htmlMarkNotations: NotationDefinition[] = [
  declareNotation(
    { kind: 'htmlMark', name: 'underline', mark: 'underline', tag: 'u' },
    [Underline],
  ),
];
