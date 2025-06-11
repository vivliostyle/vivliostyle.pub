import {
  fromPmMark,
  fromPmNode,
  fromProseMirror,
} from '@handlewithcare/remark-prosemirror';
import type { Node, Schema } from 'prosemirror-model';
import remarkGfm from 'remark-gfm';

import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

export function toVfm(doc: Node, schema: Schema) {
  const mdast = fromProseMirror(doc, {
    schema,
    nodeHandlers: {
      blockquote: fromPmNode('blockquote'),
      bulletList: fromPmNode('list', () => ({ ordered: false })),
      codeBlock: (node) => ({
        type: 'code',
        value: node.textContent,
        lang: node.attrs.language,
      }),
      hardBreak: fromPmNode('break'),
      heading: fromPmNode('heading', (node) => ({
        depth: node.attrs.level,
      })),
      horizontalRule: fromPmNode('thematicBreak'),
      listItem: fromPmNode('listItem'),
      orderedList: fromPmNode('list', () => ({ ordered: true })),
      paragraph: fromPmNode('paragraph'),
    },
    markHandlers: {
      bold: fromPmMark('strong'),
      code: (_mark, _parent, children) => ({
        type: 'inlineCode',
        value: children
          .map((child) => (child.type === 'text' ? child.value : ''))
          .join(''),
      }),
      strike: fromPmMark('delete'),
      italic: fromPmMark('emphasis'),
    },
  });

  return unified().use(remarkGfm).use(remarkStringify).stringify(mdast);
}
