import { Strike } from '@tiptap/extension-strike';
import { Underline } from '@tiptap/extension-underline';
import type { Mark } from '@tiptap/pm/model';
import remarkGfm from 'remark-gfm';

import {
  declareNotation,
  defineNotation,
  type NotationDefinition,
} from '../notation';

// GFM finds no links in the text of a link.
function inLink(marks: readonly Mark[]): boolean {
  return marks.some((mark) => mark.type.name === 'link');
}

/**
 * GitHub Flavored Markdown as VFM reads it. Tables, task list checkboxes and
 * footnotes have no definition yet and are kept as raw markdown.
 */
export const gfmNotations: NotationDefinition[] = [
  defineNotation({
    name: 'gfm',
    remarkPlugins: [remarkGfm],
    escapes: [
      // A row of cells needs pipes.
      { pattern: /\|/g },
      // A URL that GFM links takes in what follows it, escapes included, so
      // it is ended with an explicit link instead. Text that GFM autolinks
      // cannot be escaped out of it: the links are found in the text after
      // escapes are read.
      {
        pattern: /(?<![A-Za-z0-9])https?:\/\/[^\s<>]*[^\s<>.,:;!?'"]/gi,
        enclose: (url, marks) => (inLink(marks) ? null : `<${url}>`),
      },
      {
        pattern: /(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
        enclose: (address, marks) => (inLink(marks) ? null : `<${address}>`),
      },
      // Link text is markdown, so only what holds nothing to escape.
      {
        pattern:
          /(?<![A-Za-z0-9_.])www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?:\/[A-Za-z0-9/%=+-]*)?/gi,
        enclose: (domain, marks) =>
          inLink(marks) ? null : `[${domain}](http://${domain})`,
      },
    ],
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
