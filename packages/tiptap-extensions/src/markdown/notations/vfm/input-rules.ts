import {
  type ExtendedRegExpMatchArray,
  InputRule,
  PasteRule,
  type Range,
} from '@tiptap/core';
import {
  Fragment,
  type Mark,
  type Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

/** Where the source of an inline node starts and what it is made of. */
export interface InlineSource {
  state: EditorState;
  /** The position of the source's first character in the document. */
  from: number;
  match: ExtendedRegExpMatchArray;
  /** The document's content between two offsets into `match[0]`. */
  content(start: number, end: number): Fragment;
}

export type InlineBuilder = (source: InlineSource) => ProseMirrorNode | null;

/** The marks every node of `fragment` has. */
export function sharedMarks(fragment: Fragment): readonly Mark[] {
  let shared: readonly Mark[] | null = null;
  fragment.forEach((node) => {
    shared = shared
      ? shared.filter((mark) => mark.isInSet(node.marks))
      : node.marks;
  });
  return shared ?? [];
}

export function withoutMarks(
  fragment: Fragment,
  marks: readonly Mark[],
): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    nodes.push(node.mark(node.marks.filter((mark) => !mark.isInSet(marks))));
  });
  return Fragment.from(nodes);
}

function holds(
  state: EditorState,
  range: Range,
  match: ExtendedRegExpMatchArray,
): boolean {
  const length = range.to - range.from;
  const text = state.doc.textBetween(range.from, range.to, undefined, '\ufffc');
  return text.length === length && text === match[0].slice(0, length);
}

/**
 * Where pasted source is: paste rules count positions in text that leaves out
 * the ends of inline nodes with content, so a match after one that an earlier
 * rule made is off by them.
 */
function locate(
  state: EditorState,
  range: Range,
  match: ExtendedRegExpMatchArray,
): Range | null {
  const $from = state.doc.resolve(Math.min(range.from, state.doc.content.size));
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) {
    depth--;
  }
  if (!$from.node(depth).isTextblock) {
    return null;
  }
  const length = match[0].length;
  let best: Range | null = null;
  for (
    let from = $from.start(depth);
    from + length <= $from.end(depth);
    from++
  ) {
    const candidate = { from, to: from + length };
    if (
      holds(state, candidate, match) &&
      (!best || Math.abs(from - range.from) < Math.abs(best.from - range.from))
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Replaces the source at `range` with the node `build` makes of it. The marks
 * the whole source has go on the node, as reading its markdown puts them.
 */
function replaceSource(
  state: EditorState,
  given: Range,
  match: ExtendedRegExpMatchArray,
  build: InlineBuilder,
  pasted: boolean,
): null | undefined {
  const { tr, doc } = state;
  // Inline nodes count as characters in the text a rule matches, but not as
  // positions, so the match only maps onto the document when it holds none.
  const range = holds(state, given, match)
    ? given
    : pasted
      ? locate(state, given, match)
      : null;
  if (!range) {
    return null;
  }
  const length = range.to - range.from;
  const whole = doc.slice(range.from, range.to).content;
  const marks = sharedMarks(whole);
  const node = build({
    state,
    from: range.from,
    match,
    content: (start, end) =>
      withoutMarks(
        doc.slice(range.from + start, range.from + Math.min(end, length))
          .content,
        marks,
      ),
  });
  if (!node) {
    return null;
  }
  const $from = doc.resolve(range.from);
  const $to = doc.resolve(range.to);
  if (
    !$from.sameParent($to) ||
    !$from.parent.canReplaceWith($from.index(), $to.indexAfter(), node.type)
  ) {
    return null;
  }
  tr.replaceWith(range.from, range.to, node.mark(marks));
  return undefined;
}

/**
 * An input rule that makes an inline node of its source as the source is
 * closed, and the paste rule that does the same for pasted text.
 */
export function inlineSourceRules({
  find,
  build,
}: {
  /** Matches the source at the end of the text before the caret. */
  find: RegExp;
  build: InlineBuilder;
}): { input: InputRule; paste: PasteRule } {
  return {
    input: new InputRule({
      find,
      handler: ({ state, range, match }) =>
        replaceSource(state, range, match, build, false),
    }),
    paste: new PasteRule({
      find: new RegExp(
        find.source.replace(/\$$/, ''),
        `${find.flags.replace('g', '')}g`,
      ),
      handler: ({ state, range, match }) => {
        replaceSource(state, range, match, build, true);
      },
    }),
  };
}

/** Whether the character at `index` of `text` is escaped by a backslash. */
export function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    count++;
  }
  return count % 2 === 1;
}
