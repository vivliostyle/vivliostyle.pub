import type {
  Fragment,
  Node as ProseMirrorNode,
  Slice,
} from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import {
  AddMarkStep,
  AttrStep,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
} from '@tiptap/pm/transform';

/**
 * Whether the transaction came from another client: each client normalizes
 * only its own changes, or all of them would make the same change at once
 * and the document would get it once from each.
 */
export function isRemote(tr: Transaction): boolean {
  return Boolean(tr.getMeta('y-sync$'));
}

const LOADING = 'pubMarkdownLoading';

/** Marks the transaction that replaces the document with what was read. */
export function markLoading(tr: Transaction): Transaction {
  return tr.setMeta(LOADING, true);
}

/**
 * Whether the transaction put in what the markdown was read as, which a
 * plugin that changes what was typed into what it means leaves as it is.
 */
export function isLoading(tr: Transaction): boolean {
  return Boolean(tr.getMeta(LOADING));
}

function fragmentHas(
  fragment: Fragment,
  matches: (node: ProseMirrorNode) => boolean,
): boolean {
  let found = false;
  fragment.descendants((node) => {
    found ||= matches(node);
    return !found;
  });
  return found;
}

/**
 * Whether the transaction could have changed anything that depends only on
 * the nodes `matches` takes: it put in, took out or changed one of them, or
 * changed the content of a node `within` takes. Decorations that depend on
 * nothing else can be mapped through any other transaction.
 */
export function touchesNodes(
  tr: Transaction,
  matches: (node: ProseMirrorNode) => boolean,
  within?: (node: ProseMirrorNode) => boolean,
): boolean {
  return tr.steps.some((step, index) => {
    const doc = tr.docs[index];
    if (!doc) {
      return true;
    }
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      const { from, to, slice } = step as unknown as {
        from: number;
        to: number;
        slice: Slice;
      };
      if (
        fragmentHas(slice.content, matches) ||
        fragmentHas(doc.slice(from, to).content, matches)
      ) {
        return true;
      }
      const $from = doc.resolve(from);
      for (let depth = $from.depth; within && depth > 0; depth--) {
        if (within($from.node(depth))) {
          return true;
        }
      }
      return false;
    }
    if (step instanceof AttrStep) {
      const node = doc.nodeAt(step.pos);
      return !node || matches(node);
    }
    return !(step instanceof AddMarkStep || step instanceof RemoveMarkStep);
  });
}

/**
 * Where the transactions of this client changed the document they end
 * with. Steps that change marks move nothing, so they are found by the
 * range they cover.
 */
export function changedRanges(
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

/**
 * The nodes that the ranges of `changedRanges` changed, each once, from the
 * last: a deletion is a point, so the nodes around it count too.
 */
export function changedNodes(
  doc: ProseMirrorNode,
  transactions: readonly Transaction[],
  matches: (node: ProseMirrorNode) => boolean,
): { pos: number; node: ProseMirrorNode }[] {
  const found = new Map<number, ProseMirrorNode>();
  const size = doc.content.size;
  for (const { from, to } of changedRanges(transactions)) {
    doc.nodesBetween(
      Math.max(0, Math.min(from - 1, size)),
      Math.max(0, Math.min(to + 1, size)),
      (node, pos) => {
        if (matches(node)) {
          found.set(pos, node);
        }
      },
    );
  }
  return [...found]
    .map(([pos, node]) => ({ pos, node }))
    .sort((a, b) => b.pos - a.pos);
}
