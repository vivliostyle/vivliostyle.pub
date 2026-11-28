import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
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
 * are taken off, a node without content is removed when it has to have
 * some, and one inside a node it cannot be in becomes its content.
 */
export function inlineNodeRules(
  name: string,
  {
    marks = [],
    unlessInContent = [],
    needsContent = false,
    notInside = [],
  }: {
    marks?: readonly string[];
    /** Marks the node cannot have where its content has them too. */
    unlessInContent?: readonly string[];
    needsContent?: boolean;
    notInside?: readonly string[];
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
      for (const { pos: before } of found) {
        const pos = tr.mapping.map(before);
        const node = tr.doc.nodeAt(pos);
        if (node?.type.name !== name) {
          continue;
        }
        if (needsContent && node.childCount === 0) {
          tr.delete(pos, pos + node.nodeSize);
          continue;
        }
        if (isInside(tr.doc.resolve(pos), notInside)) {
          tr.replaceWith(pos, pos + node.nodeSize, contentWithMarks(node));
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

function isInside($pos: ResolvedPos, names: readonly string[]): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (names.includes($pos.node(depth).type.name)) {
      return true;
    }
  }
  return false;
}

function contentWithMarks(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(
      child.mark(
        node.marks.reduce((set, mark) => mark.addToSet(set), child.marks),
      ),
    );
  });
  return children;
}
