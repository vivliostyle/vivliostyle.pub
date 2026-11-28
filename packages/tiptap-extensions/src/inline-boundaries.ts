import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

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
    props: {
      decorations: (state) => key.getState(state),
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
 * node with content. Out of the node it goes one position. Into it, it goes
 * on past the first character as well: the caret looks the same on both
 * sides of the edge, so stopping there would look like no move.
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
  if (atEdge && hasInlineContent(parent)) {
    return forward ? $cursor.after() : $cursor.before();
  }
  const next = forward ? $cursor.nodeAfter : $cursor.nodeBefore;
  if (next && hasInlineContent(next)) {
    return stepInside(state.doc, $cursor.pos + (forward ? 1 : -1), forward);
  }
  return null;
}

function stepInside(
  doc: ProseMirrorNode,
  edge: number,
  forward: boolean,
): number {
  const $edge = doc.resolve(edge);
  const first = forward ? $edge.nodeAfter : $edge.nodeBefore;
  if (!first || hasInlineContent(first)) {
    return edge;
  }
  if (first.isText) {
    const segments = graphemes(first.text ?? '');
    const segment = (forward ? segments.at(0) : segments.at(-1)) ?? '';
    return edge + (forward ? segment.length : -segment.length);
  }
  return edge + (forward ? first.nodeSize : -first.nodeSize);
}

function graphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

/**
 * Keeps the caret right after an inline node with content out of it, and
 * lets the arrows move it into and out of the node one keypress at a time.
 */
export const InlineBoundaries = Extension.create({
  name: 'inlineBoundaries',

  addProseMirrorPlugins() {
    return [boundaryPlugin()];
  },
});
