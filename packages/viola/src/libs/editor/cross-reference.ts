import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';

import {
  CROSS_REFERENCE,
  codeBlockCaption,
  declaredElementOf,
  documentIds,
  hasDocumentNotation,
  headingText,
  knownIds,
} from '@v/tiptap-extensions';

/** Where a cross-reference can point, by the type it calls it. */
export interface ReferenceTarget {
  /** The `data-ref` of a reference to it. */
  type: string;
  /** Null where it has none yet, and is given one as it is referred to. */
  id: string | null;
  /** The id is made of the heading's text, and changes with it. */
  implicit: boolean;
  /** Text that tells it apart. */
  label: string;
  pos: number;
  node: ProseMirrorNode;
}

// The id a target given one gets, as `fig-1`.
const ID_PREFIXES: Record<string, string> = {
  fig: 'fig',
  tbl: 'tbl',
  lst: 'lst',
  eq: 'eq',
  thm: 'thm',
  sidenote: 'sn',
  sec: 'sec',
};

/** The node's text, with the LaTeX of its math. */
function textOf(node: ProseMirrorNode): string {
  let text = '';
  node.descendants((child) => {
    if (child.isText) {
      text += child.text ?? '';
    } else if (child.type.name === 'math') {
      text += ` ${String(child.attrs.latex ?? '')} `;
    }
  });
  return text;
}

function shorten(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

function attributesOf(node: ProseMirrorNode): Record<string, string> {
  const { attributes } = node.attrs;
  return attributes && typeof attributes === 'object'
    ? (attributes as Record<string, string>)
    : {};
}

/**
 * What the document holds that a cross-reference can point at: headings,
 * figures and images, code, and the declared elements a reference names,
 * in the order of the document. Figures and elements without an id are
 * there too, as is a heading whose id is made of its text.
 */
export function referenceTargets(doc: ProseMirrorNode): ReferenceTarget[] {
  const byPos = new Map(documentIds(doc).map((it) => [it.pos, it]));
  const targets: ReferenceTarget[] = [];
  doc.descendants((node, pos) => {
    const found = byPos.get(pos);
    const id = found?.id ?? null;
    const name = node.type.name;
    if (name === 'heading') {
      targets.push({
        type: 'sec',
        id,
        implicit: !found?.explicit,
        label: shorten(headingText(node)),
        pos,
        node,
      });
      return false;
    }
    // An image in text is in no figure, which themes count.
    if (name === 'image') {
      targets.push({
        type: 'fig',
        id,
        implicit: false,
        label: shorten(String(node.attrs.alt ?? '') || String(node.attrs.src)),
        pos,
        node,
      });
      return false;
    }
    // Code is counted where its caption makes it a figure.
    if (name === 'codeBlock') {
      if (id && codeBlockCaption(node.attrs.language) !== null) {
        targets.push({
          type: 'lst',
          id,
          implicit: false,
          label: shorten(codeBlockCaption(node.attrs.language) ?? ''),
          pos,
          node,
        });
      }
      return false;
    }
    const reference = declaredElementOf(doc.type.schema, name)?.reference;
    if (reference) {
      targets.push({
        type: reference,
        id,
        implicit: false,
        label: shorten(textOf(node)) || id || '',
        pos,
        node,
      });
    }
    return true;
  });
  return targets;
}

/** An id the document has nowhere, made of the type's prefix. */
export function newId(doc: ProseMirrorNode, type: string): string {
  const ids = knownIds(doc);
  const prefix = ID_PREFIXES[type] ?? type;
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!ids.has(id)) {
      return id;
    }
  }
}

/**
 * Whether the target can be referred to as it is, or be given an id first:
 * the id of a heading or an image is written as its attributes.
 */
export function canRefer(editor: Editor, target: ReferenceTarget): boolean {
  if (target.id && !target.implicit) {
    return true;
  }
  switch (target.node.type.name) {
    case 'heading':
      return (
        Boolean(target.id) || hasDocumentNotation(editor, 'headingAttributes')
      );
    case 'image':
      return hasDocumentNotation(editor, 'inlineAttributes');
    default:
      return declaredElementOf(editor.schema, target.node.type.name) !== null;
  }
}

/**
 * Inserts a reference to the target, or makes the selected one point at it,
 * giving the target an id where it has none. A heading's id made of its text
 * is written as its own, so editing the heading does not break the
 * reference.
 */
export function referTo(
  editor: Editor,
  target: ReferenceTarget,
  type: string = target.type,
): boolean {
  const { doc } = editor.state;
  const id = target.id ?? newId(doc, target.type);
  const href = `#${id}`;
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      if (target.id && !target.implicit) {
        return true;
      }
      const { node, pos } = target;
      if (declaredElementOf(editor.schema, node.type.name)) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
        return true;
      }
      const written =
        node.type.name !== 'heading' ||
        hasDocumentNotation(editor, 'headingAttributes');
      if (written) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          attributes: { ...attributesOf(node), id },
        });
      }
      return true;
    })
    .setHtmlElement(CROSS_REFERENCE, { 'data-ref': type, href })
    .run();
}

/** The reference the selection is. */
export function selectedReference(editor: Editor): ProseMirrorNode | null {
  const { selection } = editor.state;
  return selection instanceof NodeSelection &&
    selection.node.type.name === CROSS_REFERENCE
    ? selection.node
    : null;
}
