import { type Editor, Extension } from '@tiptap/core';

import {
  CROSS_REFERENCE,
  declaredElementOf,
  type FoundNode,
  findSelectedInline,
} from '@v/tiptap-extensions';
import {
  EMPTY_THEME_MARKUP,
  readThemeMarkup,
  stylesElement,
  type ThemeMarkup,
} from './theme-markup';

/** The theme's note, which it floats to the foot of the page. */
export const PAGE_FOOTNOTE = 'htmlFootnote';

export interface ThemeMarkupStorage {
  /** What the CSS the editor shows the document with styles. */
  markup: ThemeMarkup;
  /** `themeStyles` by type, for `markup`. */
  styled: Map<string, boolean>;
}

declare module '@tiptap/core' {
  interface Storage {
    themeMarkup: ThemeMarkupStorage;
  }
}

/**
 * Keeps what the theme styles with the editor, for its menus to offer only
 * the markup the theme has a look for. What the document reads as never
 * depends on it.
 */
export const ThemeMarkupExtension = Extension.create<
  Record<string, never>,
  ThemeMarkupStorage
>({
  name: 'themeMarkup',

  addStorage() {
    return { markup: EMPTY_THEME_MARKUP, styled: new Map() };
  },
});

const read = new Map<string, ThemeMarkup>();

/** Sets the CSS the editor shows the document with. */
export function setThemeCss(editor: Editor, css: string): void {
  const storage = editor.storage.themeMarkup;
  if (!storage) {
    return;
  }
  let markup = read.get(css);
  if (!markup) {
    markup = readThemeMarkup(css);
    // Every editor of a project shows the same CSS; one is enough to keep.
    read.clear();
    read.set(css, markup);
  }
  if (storage.markup !== markup) {
    storage.markup = markup;
    storage.styled = new Map();
  }
}

/** What the theme styles of `a[data-ref]`, see `ThemeMarkup`. */
export function themeReferenceTypes(editor: Editor): ReadonlySet<string> {
  return editor.storage.themeMarkup?.markup.referenceTypes ?? new Set();
}

/** Whether the theme styles the element of a declared mark or node type. */
export function themeStyles(editor: Editor, type: string): boolean {
  const storage = editor.storage.themeMarkup;
  if (!storage) {
    return false;
  }
  const known = storage.styled.get(type);
  if (known !== undefined) {
    return known;
  }
  const element = declaredElementOf(editor.schema, type);
  const styled =
    element !== null &&
    (type === CROSS_REFERENCE
      ? storage.markup.referenceTypes.size > 0
      : stylesElement(storage.markup, element.pattern));
  storage.styled.set(type, styled);
  return styled;
}

/**
 * The declared block or textblock element the selection is in, innermost
 * first, whatever the theme styles: what is there can always be taken away.
 */
export function selectedBlockElement(
  editor: Editor,
): { type: string; found: FoundNode } | null {
  const { $from, $to } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const element = declaredElementOf(editor.schema, node.type.name);
    if (
      (element?.kind === 'block' || element?.kind === 'textblock') &&
      $to.pos <= $from.before(depth) + node.nodeSize
    ) {
      return {
        type: node.type.name,
        found: { pos: $from.before(depth), node },
      };
    }
  }
  return null;
}

/** Whether the selection is in, or is, an element of the declared type. */
export function inElement(editor: Editor, type: string): boolean {
  const element = declaredElementOf(editor.schema, type);
  switch (element?.kind) {
    case 'mark':
      return editor.isActive(type);
    case 'inline':
    case 'atom':
      return findSelectedInline(editor.state, type) !== null;
    case 'block':
    case 'textblock': {
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === type) {
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}
