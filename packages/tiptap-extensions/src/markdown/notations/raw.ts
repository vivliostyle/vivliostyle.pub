import { Mark, Node } from '@tiptap/core';

import { defineNotation } from '../notation';
import { RAW_BLOCK, RAW_INLINE } from '../parse';

/**
 * Markdown the editor has no definition for, kept as written. It is edited
 * as text and written back unchanged.
 */
export const RawBlock = Node.create({
  name: RAW_BLOCK,
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: 'pre[data-raw-block]', preserveWhitespace: 'full' }];
  },

  renderHTML() {
    return ['pre', { 'data-raw-block': '' }, ['code', 0]];
  },
});

export const RawInline = Mark.create({
  name: RAW_INLINE,
  code: true,
  inclusive: false,

  parseHTML() {
    return [{ tag: 'code[data-raw-inline]' }];
  },

  renderHTML() {
    return ['code', { 'data-raw-inline': '' }, 0];
  },
});

export const rawNotation = defineNotation({
  name: 'raw',
  extensions: [RawBlock, RawInline],
  nodes: {
    [RAW_BLOCK]: (node) => node.textContent,
  },
  marks: {
    [RAW_INLINE]: { open: '', close: '', verbatim: true },
  },
});
