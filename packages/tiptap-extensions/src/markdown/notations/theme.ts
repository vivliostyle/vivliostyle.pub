import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { declareNotation, OTHER_ATTRIBUTES } from '../declare';
import type { NotationDefinition } from '../notation';
import { RAW_BLOCK, RAW_INLINE } from '../parse';
import { documentIds } from './vfm/headings';

/** The node of `<a data-ref="fig" href="#id"></a>`. */
export const CROSS_REFERENCE = 'crossReference';

const ID = ['id'];

const crossReferenceNotation = declareNotation({
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
 * Marks a cross-reference whose target the document lacks, and keeps a
 * click on one from following it as a link.
 */
const CrossReferenceTargets = Extension.create({
  name: 'crossReferenceTargets',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: missingKey,
        state: {
          init: (_, { doc }) => missingTargets(doc),
          apply: (tr, set) => (tr.docChanged ? missingTargets(tr.doc) : set),
        },
        props: {
          decorations: (state) => missingKey.getState(state),
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

/**
 * The markup of `@vivliostyle/theme-base` and the themes built on it: notes,
 * cross-references and sidenotes, equations, theorems, captions, and tables
 * in figures. The table itself stays raw markdown. It is written as HTML,
 * which VFM keeps as written, and the editor renders the same elements, so
 * a theme styles them in the editor as in the book.
 */
export const themeBaseNotations: NotationDefinition[] = [
  declareNotation({
    kind: 'htmlInline',
    name: 'htmlFootnote',
    version: 1,
    tag: 'span',
    classes: ['footnote'],
    capture: ID,
    keepOtherAttributes: true,
  }),
  {
    ...crossReferenceNotation,
    extensions: [
      ...(crossReferenceNotation.extensions ?? []),
      CrossReferenceTargets,
    ],
  },
  declareNotation({
    kind: 'htmlBlock',
    name: 'sidenote',
    version: 1,
    tag: 'aside',
    classes: ['sidenote'],
    capture: ID,
    keepOtherAttributes: true,
    reference: 'sidenote',
  }),
  declareNotation({
    kind: 'htmlBlock',
    name: 'equationBlock',
    version: 1,
    tag: 'div',
    classes: ['equation'],
    capture: ID,
    keepOtherAttributes: true,
    reference: 'eq',
  }),
  declareNotation({
    kind: 'htmlBlock',
    name: 'theoremBlock',
    version: 1,
    tag: 'div',
    classes: ['theorem'],
    capture: ID,
    keepOtherAttributes: true,
    reference: 'thm',
  }),
  declareNotation({
    kind: 'htmlBlock',
    name: 'tableFigure',
    version: 1,
    tag: 'figure',
    classes: ['tbl'],
    capture: ID,
    keepOtherAttributes: true,
    reference: 'tbl',
  }),
  declareNotation({
    kind: 'htmlTextblock',
    name: 'htmlFigcaption',
    version: 1,
    tag: 'figcaption',
    capture: ID,
    keepOtherAttributes: true,
  }),
  ...(
    [
      ['figureCaption', 'fig-caption', 'fig'],
      ['tableCaption', 'tbl-caption', 'tbl'],
      ['listingCaption', 'lst-caption', 'lst'],
    ] as const
  ).map(([name, className, reference]) =>
    declareNotation({
      kind: 'htmlTextblock',
      name,
      version: 1,
      tag: 'p',
      classes: [className],
      capture: ID,
      keepOtherAttributes: true,
      reference,
    }),
  ),
];

const span = (name: string, className: string) =>
  declareNotation({
    kind: 'htmlMark',
    name,
    version: 1,
    tag: 'span',
    classes: [className],
    keepOtherAttributes: true,
  });

const div = (name: string, className: string) =>
  declareNotation({
    kind: 'htmlBlock',
    name,
    version: 1,
    tag: 'div',
    classes: [className],
    capture: ID,
    keepOtherAttributes: true,
  });

const tcy = span('tcy', 'tcy');
const upright = span('upright', 'upright');

/**
 * Markup of particular themes, by theme, whose classes are not shared by
 * the others: those of a theme only mean something with it.
 */
export const themeNotations: Readonly<Record<string, NotationDefinition[]>> = {
  '@vivliostyle/theme-bunko': [
    tcy,
    upright,
    span('sesame', 'sesame'),
    span('sesameDot', 'sesame_dot'),
  ],
  '@vivliostyle/theme-epub3j': [tcy, upright],
  '@vivliostyle/theme-academic': [div('frameBlock', 'frame')],
  // The boxes the manuscripts of Pub's templates show in their own CSS.
  template: [div('noteBlock', 'note'), div('warningBlock', 'warning')],
};

/** Every definition of `themeNotations`, each once. */
export function allThemeNotations(): NotationDefinition[] {
  return [...new Set(Object.values(themeNotations).flat())];
}
