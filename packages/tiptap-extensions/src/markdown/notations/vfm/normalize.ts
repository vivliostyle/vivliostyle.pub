import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, type Transaction } from '@tiptap/pm/state';

/**
 * Where the transactions of this client changed the document they end
 * with. Steps that change marks move nothing, so they are found by the
 * range they cover.
 */
function changedRanges(
  transactions: readonly Transaction[],
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  transactions.forEach((tr, t) => {
    if (isRemote(tr)) {
      return;
    }
    tr.steps.forEach((step, index) => {
      const covered: { from: number; to: number }[] = [];
      step.getMap().forEach((_, __, from, to) => {
        covered.push({ from, to });
      });
      const { from, to, pos } = step as unknown as {
        from?: number;
        to?: number;
        pos?: number;
      };
      if (typeof from === 'number' && typeof to === 'number') {
        covered.push({ from, to });
      } else if (typeof pos === 'number') {
        covered.push({ from: pos, to: pos + 1 });
      }
      const rest = tr.mapping.slice(index + 1);
      for (const range of covered) {
        let start = rest.map(range.from, -1);
        let end = rest.map(range.to, 1);
        for (const later of transactions.slice(t + 1)) {
          start = later.mapping.map(start, -1);
          end = later.mapping.map(end, 1);
        }
        ranges.push({ from: start, to: end });
      }
    });
  });
  return ranges;
}

function contentHas(node: ProseMirrorNode, name: string): boolean {
  let found = false;
  node.descendants((child) => {
    found ||= child.marks.some((mark) => mark.type.name === name);
    return !found;
  });
  return found;
}

/**
 * Whether the transaction came from another client: each client normalizes
 * only its own changes, or all of them would make the same change at once
 * and the document would get it once from each.
 */
export function isRemote(tr: Transaction): boolean {
  return Boolean(tr.getMeta('y-sync$'));
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
      const ranges = changedRanges(transactions);
      const found: { pos: number; node: ProseMirrorNode }[] = [];
      const size = state.doc.content.size;
      for (const { from, to } of ranges) {
        // A deletion is a point: the nodes around it are what it changed.
        state.doc.nodesBetween(
          Math.max(0, Math.min(from - 1, size)),
          Math.max(0, Math.min(to + 1, size)),
          (node, pos) => {
            if (
              node.type.name === name &&
              !found.some((it) => it.pos === pos)
            ) {
              found.push({ pos, node });
            }
          },
        );
      }
      const { tr } = state;
      for (const { pos, node } of found.sort((a, b) => b.pos - a.pos)) {
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
