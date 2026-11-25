import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';

import { changedNodes, isRemote } from '../../changes';

function contentHas(node: ProseMirrorNode, name: string): boolean {
  let found = false;
  node.descendants((child) => {
    found ||= child.marks.some((mark) => mark.type.name === name);
    return !found;
  });
  return found;
}

/**
 * Keeps nodes of a type in a state their markdown can hold, where the
 * transactions changed the document: the marks markdown cannot put on them
 * are taken off, and a node without content is removed when it has to have
 * some.
 */
export function inlineNodeRules(
  name: string,
  {
    marks = [],
    unlessInContent = [],
    needsContent = false,
  }: {
    marks?: readonly string[];
    /** Marks the node cannot have where its content has them too. */
    unlessInContent?: readonly string[];
    needsContent?: boolean;
  },
): Plugin {
  return new Plugin({
    appendTransaction: (transactions, _, state) => {
      if (!transactions.some((tr) => tr.docChanged && !isRemote(tr))) {
        return null;
      }
      const { tr } = state;
      const found = changedNodes(
        state.doc,
        transactions,
        (node) => node.type.name === name,
      );
      for (const { pos, node } of found) {
        if (needsContent && node.childCount === 0) {
          tr.delete(pos, pos + node.nodeSize);
          continue;
        }
        for (const mark of node.marks) {
          if (
            marks.includes(mark.type.name) ||
            (unlessInContent.includes(mark.type.name) &&
              contentHas(node, mark.type.name))
          ) {
            tr.removeNodeMark(pos, mark);
          }
        }
      }
      return tr.docChanged ? tr : null;
    },
  });
}
