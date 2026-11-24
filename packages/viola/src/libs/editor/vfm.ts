import { type Editor, getMarkRange } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { type EditorState, NodeSelection } from '@tiptap/pm/state';

import {
  findSelectedInline,
  hasDocumentNotation,
  type InlineAttributes,
  isAttributeName,
  isWritableMath,
  parseMarkdown,
  writableAttributes,
} from '@v/tiptap-extensions';

/** The node of one of the types that a node selection selects. */
export function selectedNodeOf(
  state: EditorState,
  name: string,
): ProseMirrorNode | null {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === name
    ? selection.node
    : null;
}

/** The ruby the selection is in, or that it is. */
export function selectedRuby(state: EditorState): ProseMirrorNode | null {
  return findSelectedInline(state, 'ruby')?.node ?? null;
}

/**
 * Whether `$latex$` or `$$latex$$` reads back as that math where it is
 * written on its own.
 */
export function isMathSource(
  editor: Editor,
  latex: string,
  display: boolean,
): boolean {
  if (!isWritableMath(latex, display)) {
    return false;
  }
  const fence = display ? '$$' : '$';
  const { doc } = parseMarkdown(editor, `${fence}${latex}${fence}`);
  const math = doc.childCount === 1 ? doc.child(0) : null;
  return (
    math?.childCount === 1 &&
    math.child(0).type.name === 'math' &&
    math.child(0).attrs.latex === latex &&
    math.child(0).attrs.display === display
  );
}

/** The labels a document's references use, and the definitions it has. */
function footnoteLabels(doc: ProseMirrorNode): string[] {
  const labels: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'footnoteReference') {
      labels.push(String(node.attrs.label));
    } else if (node.isTextblock && node.type.spec.code) {
      for (const match of node.textContent.matchAll(/^\[\^([^\]\s]+)\]:/gm)) {
        labels.push(match[1]);
      }
    }
  });
  return labels;
}

/** The number after the largest numeric label in the document. */
export function nextFootnoteLabel(doc: ProseMirrorNode): string {
  let largest = 0;
  for (const label of footnoteLabels(doc)) {
    if (/^\d+$/.test(label)) {
      largest = Math.max(largest, Number(label));
    }
  }
  return String(largest + 1);
}

const ATTRIBUTED_MARKS = ['link', 'bold', 'italic', 'strike', 'code'];

export interface AttributedMark {
  mark: Mark;
  from: number;
  to: number;
}

/**
 * The mark around the selection that attributes would follow, i.e. the one
 * that reaches furthest, as it is written outermost.
 */
export function attributedMarkOf(state: EditorState): AttributedMark | null {
  const { $from, from, to } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) {
    return null;
  }
  const marks =
    from === to
      ? $from.marks()
      : (state.doc.nodeAt(from)?.marks ?? $from.marks());
  let best: AttributedMark | null = null;
  for (const mark of marks) {
    if (!ATTRIBUTED_MARKS.includes(mark.type.name)) {
      continue;
    }
    const range =
      getMarkRange($from, mark.type, mark.attrs) ??
      getMarkRange(state.doc.resolve(from + 1), mark.type, mark.attrs);
    if (!range || range.from > from || range.to < to) {
      continue;
    }
    if (!best || range.to - range.from > best.to - best.from) {
      best = { mark, ...range };
    }
  }
  return best;
}

/**
 * Gives the mark the attributes, or takes them away with `null`. False when
 * markdown cannot hold them there, or the document's definitions do not
 * read attributes.
 */
export function setMarkAttributes(
  editor: Editor,
  { mark, from, to }: AttributedMark,
  attributes: InlineAttributes | null,
): boolean {
  const written =
    attributes && Object.keys(attributes).length > 0
      ? writableAttributes(attributes)
      : null;
  if (
    !hasDocumentNotation(editor, 'inlineAttributes') ||
    (attributes && Object.keys(attributes).length > 0 && !written) ||
    Object.keys(attributes ?? {}).some((name) => !isAttributeName(name))
  ) {
    return false;
  }
  const next = mark.type.create({ ...mark.attrs, attributes: written });
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.removeMark(from, to, mark).addMark(from, to, next);
      return true;
    })
    .run();
  return true;
}
