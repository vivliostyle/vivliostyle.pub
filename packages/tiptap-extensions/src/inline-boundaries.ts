import { Extension } from '@tiptap/core';
import { type Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { typesAtCaret } from './typed-marks';

/** An inline node that holds text, such as a note written in the line. */
export function hasInlineContent(node: ProseMirrorNode): boolean {
  return node.isInline && !node.isText && !node.isLeaf && node.inlineContent;
}

function boundary(view: EditorView): HTMLElement {
  const element = view.dom.ownerDocument.createElement('span');
  element.contentEditable = 'false';
  element.className = 'ProseMirror-inline-boundary';
  // Zero width, and no line break opportunity next to the node.
  element.textContent = '⁠';
  return element;
}

const BEFORE = { key: 'inline-boundary-before', side: 1 };
const AFTER = { key: 'inline-boundary-after', side: -1 };

function boundariesIn(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): Decoration[] {
  const found: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (hasInlineContent(node)) {
      found.push(
        Decoration.widget(pos, boundary, BEFORE),
        Decoration.widget(pos + node.nodeSize, boundary, AFTER),
      );
    }
  });
  return found;
}

/**
 * Where the caret at the position rests: out of each inline node with
 * content whose inside edge it is at, since the caret looks the same right
 * outside. Only an empty node keeps the caret, where its content is typed.
 */
export function restingPlace(doc: ProseMirrorNode, pos: number): number {
  let $pos = doc.resolve(pos);
  for (;;) {
    const { parent } = $pos;
    if (!hasInlineContent(parent) || parent.content.size === 0) {
      return $pos.pos;
    }
    if ($pos.parentOffset === 0) {
      $pos = doc.resolve($pos.before());
    } else if ($pos.parentOffset === parent.content.size) {
      $pos = doc.resolve($pos.after());
    } else {
      return $pos.pos;
    }
  }
}

/** The textblocks the transaction changed, in the document it ends with. */
function changedTextblocks(tr: Transaction): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_, __, from, to) => {
      ranges.push({ from: rest.map(from, -1), to: rest.map(to, 1) });
    });
  });
  const size = tr.doc.content.size;
  return ranges.map(({ from, to }) => {
    const $from = tr.doc.resolve(Math.max(0, Math.min(from, size)));
    const $to = tr.doc.resolve(Math.max(0, Math.min(to, size)));
    const depth = (pos: typeof $from) => {
      let d = pos.depth;
      while (d > 0 && !pos.node(d).isTextblock) {
        d--;
      }
      return d;
    };
    const start = depth($from) > 0 ? $from.before(depth($from)) : $from.pos;
    const end = depth($to) > 0 ? $to.after(depth($to)) : $to.pos;
    return { from: start, to: end };
  });
}

const key = new PluginKey<DecorationSet>('inlineBoundaries');

/**
 * Where an inline node with content ends, the DOM has one place for two
 * positions, inside it and after it, and the browser puts what is typed
 * there inside. A widget that cannot be edited on each side of the node
 * keeps the two apart, as the `rt` of a ruby does.
 */
function boundaryPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) =>
        DecorationSet.create(
          state.doc,
          boundariesIn(state.doc, 0, state.doc.content.size),
        ),
      apply: (tr, set) => {
        if (!tr.docChanged) {
          return set;
        }
        let next = set.map(tr.mapping, tr.doc);
        for (const { from, to } of changedTextblocks(tr)) {
          next = next
            .remove(next.find(from, to))
            .add(tr.doc, boundariesIn(tr.doc, from, to));
        }
        return next;
      },
    },
    // Typing goes on where it went, so that text typed into an empty node
    // stays in it past the first character.
    appendTransaction: (transactions, _, state) => {
      const { selection } = state;
      if (
        !(selection instanceof TextSelection) ||
        !selection.$cursor ||
        transactions.some(typesAtCaret) ||
        !transactions.some(
          (tr) =>
            tr.selectionSet ||
            tr.steps.some(
              (step) =>
                step instanceof ReplaceStep ||
                step instanceof ReplaceAroundStep,
            ),
        )
      ) {
        return null;
      }
      const pos = restingPlace(state.doc, selection.head);
      return pos === selection.head
        ? null
        : state.tr.setSelection(TextSelection.create(state.doc, pos));
    },
    props: {
      decorations: (state) => key.getState(state),
      transformCopied: (slice, view) => copiedSlice(view.state, slice),
      handleDOMEvents: {
        // The view takes off the selection it cuts, so it is made what
        // copying takes.
        cut: (view) => {
          const range = copiedRange(view.state);
          if (range) {
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, range.from, range.to),
              ),
            );
          }
          return false;
        },
      },
      handleKeyDown: (view, event) => {
        if (
          (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !isHorizontalLtr(view)
        ) {
          return false;
        }
        const target = crossing(view.state, event.key === 'ArrowRight');
        if (target === null) {
          return false;
        }
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, target))
            .scrollIntoView(),
        );
        return true;
      },
    },
  });
}

/**
 * The range that copying the selection takes, when it is not the selection.
 * An end at the inside edge of an inline node with content looks to be
 * outside the node, and is taken as outside it where the selection covers
 * all of its content or none of it.
 */
function copiedRange(state: EditorState): { from: number; to: number } | null {
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection) || selection.empty) {
    return null;
  }
  let { from, to } = selection;
  for (;;) {
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    if (hasInlineContent($from.parent) && $from.pos === $from.end()) {
      from = $from.after();
    } else if (
      hasInlineContent($from.parent) &&
      $from.pos === $from.start() &&
      to >= $from.end()
    ) {
      from = $from.before();
    } else if (hasInlineContent($to.parent) && $to.pos === $to.start()) {
      to = $to.before();
    } else if (
      hasInlineContent($to.parent) &&
      $to.pos === $to.end() &&
      from <= $to.start()
    ) {
      to = $to.after();
    } else {
      break;
    }
  }
  return from === selection.from && to === selection.to ? null : { from, to };
}

/**
 * What copying the selection takes: an inline node with content goes along
 * only where the selection covers all of its content, see `copiedRange`. Of
 * one it covers in part, only that part of the content goes, with the
 * node's marks. A slice left open into the node would paste as part of the
 * node it is pasted into, if any, or else as its content alone.
 */
export function copiedSlice(state: EditorState, slice: Slice): Slice {
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection) || !slice.eq(selection.content())) {
    return slice;
  }
  const { from, to } = copiedRange(state) ?? selection;
  const partial = new Set<number>();
  for (const $pos of [doc.resolve(from), doc.resolve(to)]) {
    for (let depth = $pos.depth; depth > 0; depth--) {
      if (hasInlineContent($pos.node(depth))) {
        partial.add($pos.before(depth));
      }
    }
  }
  if (partial.size === 0) {
    return from === selection.from && to === selection.to
      ? slice
      : doc.slice(from, to, true);
  }
  const tr = state.tr;
  for (const pos of partial) {
    const start = tr.mapping.map(pos);
    const node = tr.doc.nodeAt(start);
    if (!node) {
      continue;
    }
    const end = start + node.nodeSize;
    tr.step(
      new ReplaceAroundStep(start, end, start + 1, end - 1, Slice.empty, 0),
    );
    for (const mark of node.marks) {
      tr.addMark(start, start + node.content.size, mark);
    }
  }
  return tr.doc.slice(tr.mapping.map(from), tr.mapping.map(to), true);
}

// In vertical or right-to-left text the arrows mean other directions, which
// the browser keeps track of.
function isHorizontalLtr(view: EditorView): boolean {
  const style = view.dom.ownerDocument?.defaultView?.getComputedStyle?.(
    view.dom,
  );
  return (
    !style ||
    ((!style.writingMode || style.writingMode.startsWith('horizontal')) &&
      style.direction !== 'rtl')
  );
}

/**
 * Where the caret goes when an arrow moves it over the edge of an inline
 * node with content, into it or out of it. It goes on past the character on
 * the other side as well: the caret looks the same on both sides of the
 * edge, so stopping there would look like no move.
 */
export function crossing(state: EditorState, forward: boolean): number | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.$cursor) {
    return null;
  }
  const $cursor = selection.$cursor;
  const { parent } = $cursor;
  const atEdge = forward
    ? $cursor.parentOffset === parent.content.size
    : $cursor.parentOffset === 0;
  const next = forward ? $cursor.nodeAfter : $cursor.nodeBefore;
  let target: number;
  if (atEdge && hasInlineContent(parent)) {
    target = stepPast(
      state.doc,
      forward ? $cursor.after() : $cursor.before(),
      forward,
    );
  } else if (next && hasInlineContent(next)) {
    target = stepPast(state.doc, $cursor.pos + (forward ? 1 : -1), forward);
  } else if (next && hasInlineContent(parent)) {
    const step = $cursor.pos + (forward ? 1 : -1) * stepSize(next, forward);
    target = restingPlace(state.doc, step);
    return target === step ? null : target;
  } else {
    return null;
  }
  return restingPlace(state.doc, target);
}

function stepSize(node: ProseMirrorNode, forward: boolean): number {
  if (!node.isText) {
    return node.nodeSize;
  }
  const segments = graphemes(node.text ?? '');
  return ((forward ? segments.at(0) : segments.at(-1)) ?? '').length;
}

function stepPast(
  doc: ProseMirrorNode,
  edge: number,
  forward: boolean,
): number {
  const $edge = doc.resolve(edge);
  const first = forward ? $edge.nodeAfter : $edge.nodeBefore;
  if (!first) {
    return edge;
  }
  if (hasInlineContent(first)) {
    return stepPast(doc, edge + (forward ? 1 : -1), forward);
  }
  return edge + (forward ? 1 : -1) * stepSize(first, forward);
}

/**
 * What Backspace or Delete takes off right outside an inline node with
 * content: the character inside it nearest the caret, as though the node
 * were plain text, or the whole node when that is all it holds. The browser
 * would delete the whole node with the boundary next to it.
 */
export function deletionInside(
  state: EditorState,
  forward: boolean,
): { from: number; to: number } | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.$cursor) {
    return null;
  }
  const $cursor = selection.$cursor;
  let pos = $cursor.pos;
  let node = forward ? $cursor.nodeAfter : $cursor.nodeBefore;
  if (!node || !hasInlineContent(node)) {
    return null;
  }
  while (node && hasInlineContent(node)) {
    if (node.content.size === 0) {
      return wholeIfEmptied(state.doc, range(pos, node.nodeSize, forward));
    }
    pos += forward ? 1 : -1;
    const $pos = state.doc.resolve(pos);
    node = forward ? $pos.nodeAfter : $pos.nodeBefore;
  }
  if (!node) {
    return null;
  }
  let size = node.nodeSize;
  if (node.isText) {
    const segments = graphemes(node.text ?? '');
    size = ((forward ? segments.at(0) : segments.at(-1)) ?? '').length;
  }
  return wholeIfEmptied(state.doc, range(pos, size, forward));
}

function wholeIfEmptied(
  doc: ProseMirrorNode,
  deleted: { from: number; to: number },
): { from: number; to: number } {
  let { from, to } = deleted;
  for (;;) {
    const $from = doc.resolve(from);
    if (
      !hasInlineContent($from.parent) ||
      from !== $from.start() ||
      to !== $from.end()
    ) {
      return { from, to };
    }
    from = $from.before();
    to = $from.after();
  }
}

function range(
  pos: number,
  size: number,
  forward: boolean,
): { from: number; to: number } {
  return forward
    ? { from: pos, to: pos + size }
    : { from: pos - size, to: pos };
}

function graphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

/**
 * Keeps the caret at the edges of an inline node with content out of it,
 * lets one press of an arrow move it into or out of the node, and lets
 * Backspace and Delete from outside take off one character of it.
 */
export const InlineBoundaries = Extension.create({
  name: 'inlineBoundaries',

  addKeyboardShortcuts() {
    const deleteInside = (forward: boolean) => () =>
      this.editor.commands.first(({ commands }) => [
        // As the core keymap would, which only gets the key after this.
        () => commands.undoInputRule(),
        () =>
          commands.command(({ state, tr, dispatch }) => {
            const found = deletionInside(state, forward);
            if (!found) {
              return false;
            }
            if (dispatch) {
              tr.delete(found.from, found.to).scrollIntoView();
            }
            return true;
          }),
      ]);
    return {
      Backspace: deleteInside(false),
      Delete: deleteInside(true),
    };
  },

  addProseMirrorPlugins() {
    return [boundaryPlugin()];
  },
});
