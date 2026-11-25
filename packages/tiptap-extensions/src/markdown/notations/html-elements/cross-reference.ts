import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { touchesNodes } from '../../changes';
import { declareNotation, OTHER_ATTRIBUTES } from '../../declare';
import type { NotationDefinition } from '../../notation';
import { RAW_BLOCK, RAW_INLINE } from '../../parse';
import { documentIds } from '../vfm/headings';

/** The node of `<a data-ref="fig" href="#id"></a>`. */
export const CROSS_REFERENCE = 'crossReference';

const declared = declareNotation({
  kind: 'htmlAtom',
  name: CROSS_REFERENCE,
  version: 1,
  tag: 'a',
  capture: ['data-ref', 'href'],
  require: ['data-ref', 'href'],
  keepOtherAttributes: true,
});

const ATTRIBUTE_ID_RE =
  /(?:^|[\s"'])id[ \t\n]*=[ \t\n]*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/**
 * The ids an element of the document has, also in raw HTML and in the
 * attributes of marks, which a cross-reference can point at.
 */
export function knownIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set(documentIds(doc).map((it) => it.id));
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) {
      ids.add(value);
    }
  };
  const fromAttributes = (attrs: Record<string, unknown>) => {
    for (const name of ['attributes', OTHER_ATTRIBUTES]) {
      add((attrs[name] as Record<string, unknown> | null)?.id);
    }
  };
  doc.descendants((node) => {
    fromAttributes(node.attrs);
    for (const mark of node.marks) {
      fromAttributes(mark.attrs);
    }
    const raw =
      node.type.name === RAW_BLOCK
        ? node.textContent
        : node.isText && node.marks.some((it) => it.type.name === RAW_INLINE)
          ? (node.text ?? '')
          : '';
    if (raw.includes('id')) {
      for (const match of raw.matchAll(ATTRIBUTE_ID_RE)) {
        add(match[1] ?? match[2] ?? match[3]);
      }
    }
  });
  return ids;
}

/** The id in the document a cross-reference points at, if it is one. */
export function referencedId(href: unknown): string | null {
  if (typeof href !== 'string' || !href.startsWith('#') || href.length < 2) {
    return null;
  }
  const id = href.slice(1);
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

const missingKey = new PluginKey<DecorationSet>('crossReferenceTargets');

/**
 * Whether a node refers to an id or may give one, which a step touching it
 * can change: a heading's is made of its text, so a step in one does too.
 */
function givesIds(node: ProseMirrorNode): boolean {
  return (
    node.type.name === CROSS_REFERENCE ||
    node.type.name === 'heading' ||
    node.type.name === 'sectionEnd' ||
    node.type.name === 'image' ||
    node.type.name === 'inlineImage' ||
    node.type.name === 'codeBlock' ||
    node.type.name === RAW_BLOCK ||
    Boolean(node.type.spec.htmlElement) ||
    Boolean(node.attrs.attributes) ||
    node.marks.some(
      (mark) => mark.type.name === RAW_INLINE || Boolean(mark.attrs.attributes),
    )
  );
}

function missingTargets(doc: ProseMirrorNode): DecorationSet {
  let ids: Set<string> | null = null;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== CROSS_REFERENCE) {
      return true;
    }
    const id = referencedId(node.attrs.href);
    ids ??= id === null ? null : knownIds(doc);
    if (id !== null && ids && !ids.has(id)) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { 'data-missing': '' }),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Whether a click would make the browser follow a link of the document:
 * one in an element that is not editable, such as a reference, which the
 * editor's own handling of links does not open.
 */
export function followsLink(event: Event, root: Node): boolean {
  const target = event.target as Element | null;
  const link =
    typeof target?.closest === 'function' ? target.closest('a[href]') : null;
  return link !== null && root.contains(link);
}

/**
 * Marks a cross-reference whose target the document lacks, and keeps a
 * click on any link of the document from following it.
 */
const CrossReferenceTargets = Extension.create({
  name: 'crossReferenceTargets',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: missingKey,
        state: {
          init: (_, { doc }) => missingTargets(doc),
          apply: (tr, set) =>
            !tr.docChanged
              ? set
              : touchesNodes(
                    tr,
                    givesIds,
                    (node) => node.type.name === 'heading',
                  )
                ? missingTargets(tr.doc)
                : set.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => missingKey.getState(state),
          // A reference is not editable, so a browser follows it on a click.
          handleDOMEvents: {
            click: (view, event) => {
              if (followsLink(event, view.dom)) {
                event.preventDefault();
              }
              return false;
            },
          },
          handleClickOn: (view, _, node, nodePos) => {
            if (node.type.name !== CROSS_REFERENCE) {
              return false;
            }
            view.dispatch(
              view.state.tr.setSelection(
                NodeSelection.create(view.state.doc, nodePos),
              ),
            );
            return true;
          },
        },
      }),
    ];
  },
});

/** `<a data-ref="fig" href="#id"></a>`, marked where its target is missing. */
export const crossReferenceNotation: NotationDefinition = {
  ...declared,
  extensions: [...(declared.extensions ?? []), CrossReferenceTargets],
};
