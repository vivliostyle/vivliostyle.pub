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
    // A row of cells needs pipes. Text that GFM autolinks cannot be escaped
    // out of it: the links are found in the text after escapes are read.
    escapes: [{ pattern: /\|/g }],
  }),
  declareNotation(
    {
      kind: 'delimitedMark',
      name: 'strikethrough',
      mark: 'strike',
      mdastType: 'delete',
      delimiter: '~~',
      tag: 'del',
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
