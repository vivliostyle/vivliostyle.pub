import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const keys = new WeakMap<ProseMirrorNode, string>();

/** Two nodes are the same content exactly when their keys are equal. */
export function keyOf(node: ProseMirrorNode): string {
  let key = keys.get(node);
  if (key === undefined) {
    key = JSON.stringify(node.toJSON());
    keys.set(node, key);
  }
  return key;
}

// Beyond this many cells the middle of two sequences is left unmatched
// rather than spending quadratic time on it.
const MAX_LCS_CELLS = 4_000_000;

/** For each item of `a`, the index of the item of `b` it is matched with. */
export function matchSequences(
  a: readonly string[],
  b: readonly string[],
): number[] {
  const matches = a.map(() => -1);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    matches[head] = head;
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    matches[a.length - 1 - tail] = b.length - 1 - tail;
    tail++;
  }
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) {
    return matches;
  }
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] =
        a[head + i] === b[head + j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[head + i] === b[head + j]) {
      matches[head + i] = head + j;
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matches;
}
