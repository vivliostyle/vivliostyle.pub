import { type Editor, Extension } from '@tiptap/core';

import {
  CROSS_REFERENCE,
  declaredElementOf,
  type FoundNode,
  findSelectedInline,
  hasDocumentNotation,
} from '@v/tiptap-extensions';
import {
  EMPTY_THEME_MARKUP,
  readThemeMarkup,
  stylesElement,
  type ThemeMarkup,
} from './theme-markup';

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
 * Whether the theme styles the element and the document can hold it, which
 * the menus offer it for.
 */
export function offersElement(editor: Editor, type: string): boolean {
  const element = declaredElementOf(editor.schema, type);
  return (
    element !== null &&
    themeStyles(editor, type) &&
    hasDocumentNotation(editor, element.notation)
  );
}

const THEME_FOOTNOTE = 'htmlFootnote';

/**
 * The note the editor makes: the theme's element where the theme styles it,
 * which it floats to the foot of the page, and otherwise VFM's `^[…]`, which
 * VFM collects at the end unless the project sets its gcpm mode.
 */
export function footnoteType(editor: Editor): string {
  return offersElement(editor, THEME_FOOTNOTE)
    ? THEME_FOOTNOTE
    : 'inlineFootnote';
}

/** The note of either kind the selection is in. */
export function selectedFootnote(
  editor: Editor,
): { type: string; found: FoundNode } | null {
  for (const type of [THEME_FOOTNOTE, 'inlineFootnote']) {
    const found = findSelectedInline(editor.state, type);
    if (found) {
      return { type, found };
    }
  }
  return null;
}

/** Makes a note of the selection, or inserts one holding `text`. */
export function setFootnote(editor: Editor, text?: string): boolean {
  const chain = editor.chain().focus();
  return (
    footnoteType(editor) === THEME_FOOTNOTE
      ? chain.setHtmlElement(THEME_FOOTNOTE, null, text)
      : chain.setInlineFootnote(text)
  ).run();
}

export function canSetFootnote(editor: Editor, text?: string): boolean {
  return footnoteType(editor) === THEME_FOOTNOTE
    ? editor.can().setHtmlElement(THEME_FOOTNOTE, null, text)
    : editor.can().setInlineFootnote(text);
}

/** Leaves the content of the note the selection is in as text. */
export function unsetFootnote(editor: Editor): boolean {
  const selected = selectedFootnote(editor);
  if (!selected) {
    return false;
  }
  const chain = editor.chain().focus();
  return (
    selected.type === THEME_FOOTNOTE
      ? chain.unsetHtmlElement(THEME_FOOTNOTE)
      : chain.unsetInlineFootnote()
  ).run();
}
