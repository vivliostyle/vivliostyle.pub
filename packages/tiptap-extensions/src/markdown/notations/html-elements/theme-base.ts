import { declareNotation } from '../../declare';
import type { NotationDefinition } from '../../notation';
import { crossReferenceNotation } from './cross-reference';

const ID = ['id'];

/**
 * The markup of `@vivliostyle/theme-base` and the themes built on it: notes,
 * cross-references and sidenotes, equations, theorems, captions, and tables
 * in figures. The table itself stays raw markdown. It is written as HTML,
 * which VFM keeps as written, and the editor renders the same elements, so
 * a theme styles them in the editor as in the book.
 */
export const themeBaseElementNotations: NotationDefinition[] = [
  declareNotation({
    kind: 'htmlInline',
    name: 'htmlFootnote',
    version: 1,
    tag: 'span',
    classes: ['footnote'],
    capture: ID,
    keepOtherAttributes: true,
  }),
  crossReferenceNotation,
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
    content: 'htmlFigcaption? block+ htmlFigcaption?',
  }),
  // A caption of nothing but the table's, which HTML from elsewhere has too.
  declareNotation({
    kind: 'htmlTextblock',
    name: 'htmlFigcaption',
    version: 1,
    tag: 'figcaption',
    capture: ID,
    keepOtherAttributes: true,
    group: null,
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
