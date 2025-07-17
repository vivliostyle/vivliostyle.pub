import {
  fromPmMark,
  fromPmNode,
  fromProseMirror,
  type RemarkProseMirrorOptions,
  remarkProseMirror,
  toPmMark,
  toPmNode,
} from '@handlewithcare/remark-prosemirror';
import type { Node, Schema } from 'prosemirror-model';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

export function fromVfm(content: string, schema: Schema) {
  const doc = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkProseMirror, {
      schema,
      handlers: {
        blockquote: toPmNode(schema.nodes.blockquote),
        break: toPmNode(schema.nodes.hardBreak),
        code: (node, _parent, _state) =>
          schema.nodes.codeBlock.createAndFill(
            { language: node.lang },
            schema.text(node.value),
          ),
        delete: toPmMark(schema.marks.strike),
        emphasis: toPmMark(schema.marks.italic),
        heading: toPmNode(schema.nodes.heading, (node) => ({
          level: node.depth,
        })),
        inlineCode: (node, _parent, _state) =>
          schema.text(node.value, [schema.marks.code.create()]),
        list: (node, _parent, state) => {
          const children = state.all(node);
          const nodeType = node.ordered
            ? schema.nodes.orderedList
            : schema.nodes.bulletList;
          return nodeType.createAndFill({}, children);
        },
        listItem: toPmNode(schema.nodes.listItem),
        paragraph: toPmNode(schema.nodes.paragraph),
        strong: toPmMark(schema.marks.bold),
        thematicBreak: toPmNode(schema.nodes.horizontalRule),
      },
    } satisfies RemarkProseMirrorOptions)
    .processSync(content);

  return doc.result as Node;
}

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
