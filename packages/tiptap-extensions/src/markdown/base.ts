import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import type { InlineSource, ParsedBody } from './parse';
import { stripPrefixes } from './source';

/**
 * A node of the markdown a document was last read from or written as, with
 * the source it was read from. The writer reuses that source for nodes that
 * did not change.
 */
export interface BaseNode {
  node: ProseMirrorNode;
  /** As written, without the prefixes of the containers around it. */
  text: string | null;
  /** The source of the node's children, or `null` when it is not known. */
  content(): BaseContent | null;
  /**
   * Where a textblock's content was written, piece by piece, when the parser
   * that read it knows. Otherwise the writer finds the pieces in `text`.
   */
  inline?(): InlineSource | null;
}

export interface BaseContent {
  /** One entry for each child of the node. */
  children: readonly (BaseNode | null)[];
  /**
   * What was written between the child at `index` and the next one, or
   * `null` when either has no source.
   */
  separator(index: number): string | null;
}

export interface BaseDocument extends BaseContent {
  /** What came before the first block and after the last one. */
  leading: string;
  trailing: string;
  /**
   * Source that belongs to no block, such as a link reference definition the
   * old parser left out of the document. It is kept when the block it
   * follows is rewritten.
   */
  detached?: ReadonlyMap<number, string>;
}

function baseNodeOf(
  parsed: ParsedBody,
  node: ProseMirrorNode,
): BaseNode | null {
  const range = parsed.ranges.get(node);
  if (!range) {
    return null;
  }
  return {
    node,
    text: stripPrefixes(parsed.body.slice(range.start, range.end), [
      ...range.prefixes,
    ]),
    content: () => contentOf(parsed, node),
    inline: () => parsed.inlines.get(node) ?? null,
  };
}

function contentOf(parsed: ParsedBody, node: ProseMirrorNode): BaseContent {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return {
    children: children.map((child) => baseNodeOf(parsed, child)),
    separator(index) {
      const previous = parsed.ranges.get(children[index]);
      const next = parsed.ranges.get(children[index + 1]);
      if (!previous || !next) {
        return null;
      }
      return stripPrefixes(parsed.body.slice(previous.end, next.start), [
        ...next.prefixes,
      ]);
    },
  };
}

export function baseDocumentOf(parsed: ParsedBody): BaseDocument {
  const content = contentOf(parsed, parsed.doc);
  const ranges = content.children.flatMap((child) =>
    child ? [parsed.ranges.get(child.node)] : [],
  );
  const first = ranges.at(0);
  const last = ranges.at(-1);
  if (!first || !last) {
    return { ...content, leading: '', trailing: parsed.body };
  }
  return {
    ...content,
    leading: parsed.body.slice(0, first.start),
    trailing: parsed.body.slice(last.end),
  };
}
