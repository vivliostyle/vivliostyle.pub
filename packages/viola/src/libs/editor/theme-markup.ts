import { type CssBlockItem, CssScanner } from '../theme-variables/css-scanner';

/** What one compound selector of a stylesheet selects an element by. */
export interface CompoundSelector {
  /** Lower-cased, or null for any element. */
  tag: string | null;
  classes: string[];
  /** Attribute selectors, with the value they compare with, if any. */
  attributes: { name: string; value: string | null }[];
}

/** What a declared element is, as far as a selector can tell. */
export interface ElementSelector {
  tag: string;
  classes?: readonly string[] | undefined;
  match?: Readonly<Record<string, string>> | undefined;
}

/** The markup a theme's CSS styles. */
export interface ThemeMarkup {
  /** Compound selectors of every style rule. */
  compounds: readonly CompoundSelector[];
  /** The types of `a[data-ref]` it styles, such as `fig`. */
  referenceTypes: ReadonlySet<string>;
}

// At-rules whose blocks hold style rules; `@page` and the like hold none.
const GROUPING = new Set([
  'media',
  'supports',
  'layer',
  'container',
  'scope',
  'document',
  'starting-style',
]);

// Pseudo-classes whose arguments select the element itself.
const SAME_ELEMENT = new Set([
  'is',
  'where',
  'matches',
  'any',
  '-webkit-any',
  '-moz-any',
]);

function isWhitespace(char: string | undefined): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f'
  );
}

function isNameChar(char: string | undefined): boolean {
  return (
    char !== undefined &&
    (/[A-Za-z0-9_-]/.test(char) || char.charCodeAt(0) > 0x7f)
  );
}

/** Reads a CSS identifier at `start`, with its escapes resolved. */
function readName(text: string, start: number): { name: string; end: number } {
  let name = '';
  let i = start;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      let hex = '';
      let j = i + 1;
      while (j < text.length && hex.length < 6 && /[0-9A-Fa-f]/.test(text[j])) {
        hex += text[j];
        j++;
      }
      if (hex) {
        name += String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd);
        i = isWhitespace(text[j]) ? j + 1 : j;
      } else if (j < text.length) {
        name += text[j];
        i = j + 1;
      } else {
        i = j;
      }
    } else if (isNameChar(char)) {
      name += char;
      i++;
    } else {
      break;
    }
  }
  return { name, end: i };
}

/** The end of a quoted string that starts at `start`. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    i += text[i] === '\\' ? 2 : 1;
  }
  return Math.min(i + 1, text.length);
}

/** The index of the bracket that closes the one at `start`. */
function closingBracket(text: string, start: number): number {
  const open = text[start];
  const close = open === '(' ? ')' : ']';
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'") {
      i = skipString(text, i);
      continue;
    }
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return text.length;
}

/** A string's content with its escapes resolved. */
function readString(text: string, start: number): string {
  const quote = text[start];
  let value = '';
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') {
      const { name, end } = readName(text, i);
      value += name || (text[i + 1] ?? '');
      i = name ? end : i + 2;
    } else {
      value += text[i];
      i++;
    }
  }
  return value;
}

/** An attribute selector's value: a string or an identifier. */
function readValue(text: string): string {
  let i = 0;
  while (isWhitespace(text[i])) {
    i++;
  }
  return text[i] === '"' || text[i] === "'"
    ? readString(text, i)
    : readName(text, i).name;
}

/** `[name op value flags]` without its brackets. */
function readAttribute(
  inner: string,
): { name: string; value: string | null } | null {
  let i = 0;
  while (isWhitespace(inner[i])) {
    i++;
  }
  // A namespace prefix, `*|name` or `ns|name`, is left out.
  const bar = inner.indexOf('|');
  if (bar !== -1 && inner[bar + 1] !== '=') {
    i = bar + 1;
  }
  const { name, end } = readName(inner, i);
  if (!name) {
    return null;
  }
  const rest = inner.slice(end).trimStart();
  const operator = rest.match(/^[~|^$*]?=/)?.[0];
  if (!operator) {
    return { name: name.toLowerCase(), value: null };
  }
  return {
    name: name.toLowerCase(),
    value:
      operator === '=' || operator === '~='
        ? readValue(rest.slice(operator.length))
        : null,
  };
}

function emptyCompound(): CompoundSelector {
  return { tag: null, classes: [], attributes: [] };
}

function isEmpty(compound: CompoundSelector): boolean {
  return (
    compound.tag === null &&
    compound.classes.length === 0 &&
    compound.attributes.length === 0
  );
}

/**
 * The compound selectors of a selector list. Those in `:is()` and `:where()`
 * count as the element's own, those in `:has()` as other elements', and
 * those in `:not()` and other functions not at all.
 */
export function compoundSelectors(selectors: string): CompoundSelector[] {
  const result: CompoundSelector[] = [];
  let current = emptyCompound();
  const flush = () => {
    if (!isEmpty(current)) {
      result.push(current);
    }
    current = emptyCompound();
  };
  let i = 0;
  while (i < selectors.length) {
    const char = selectors[i];
    if (char === '/' && selectors[i + 1] === '*') {
      const end = selectors.indexOf('*/', i + 2);
      i = end === -1 ? selectors.length : end + 2;
    } else if (
      isWhitespace(char) ||
      char === ',' ||
      char === '>' ||
      char === '+' ||
      char === '~'
    ) {
      flush();
      i++;
    } else if (char === '.' || char === '#') {
      const { name, end } = readName(selectors, i + 1);
      if (char === '.' && name) {
        current.classes.push(name);
      }
      i = Math.max(end, i + 1);
    } else if (char === '[') {
      const end = closingBracket(selectors, i);
      const attribute = readAttribute(selectors.slice(i + 1, end));
      if (attribute?.name === 'class' && attribute.value !== null) {
        current.classes.push(...attribute.value.split(/\s+/).filter(Boolean));
      } else if (attribute) {
        current.attributes.push(attribute);
      }
      i = end + 1;
    } else if (char === ':') {
      const element = selectors[i + 1] === ':';
      const { name, end } = readName(selectors, i + (element ? 2 : 1));
      i = Math.max(end, i + 1);
      if (selectors[i] === '(') {
        const close = closingBracket(selectors, i);
        const args = selectors.slice(i + 1, close);
        const pseudo = name.toLowerCase();
        if (!element && SAME_ELEMENT.has(pseudo)) {
          for (const inner of compoundSelectors(args)) {
            current.classes.push(...inner.classes);
            current.attributes.push(...inner.attributes);
          }
        } else if (!element && pseudo === 'has') {
          result.push(...compoundSelectors(args));
        }
        i = close + 1;
      }
    } else if (char === '*') {
      i++;
    } else if (isNameChar(char) || char === '\\') {
      const { name, end } = readName(selectors, i);
      if (selectors[end] === '|') {
        i = end + 1;
      } else {
        current.tag = name.toLowerCase();
        i = Math.max(end, i + 1);
      }
    } else if (char === '"' || char === "'") {
      i = skipString(selectors, i);
    } else {
      i++;
    }
  }
  flush();
  return result;
}

/** The preludes of every style rule, also inside grouping and nested rules. */
function stylePreludes(css: string): string[] {
  const scanner = new CssScanner(css);
  const preludes: string[] = [];
  const visit = (items: readonly CssBlockItem[]) => {
    for (const item of items) {
      if (item.type !== 'rule' || !item.block) {
        continue;
      }
      if (item.atName === null) {
        preludes.push(item.prelude);
        visit(scanner.scanBlock(item.block));
      } else if (GROUPING.has(item.atName)) {
        visit(scanner.scanBlock(item.block));
      }
    }
  };
  visit(scanner.scanStylesheet());
  return preludes;
}

/** Reads what the style rules of `css` select elements by. */
export function readThemeMarkup(css: string): ThemeMarkup {
  const compounds = stylePreludes(css).flatMap(compoundSelectors);
  const referenceTypes = new Set<string>();
  for (const compound of compounds) {
    if (compound.tag !== null && compound.tag !== 'a') {
      continue;
    }
    for (const { name, value } of compound.attributes) {
      if (name === 'data-ref' && value) {
        referenceTypes.add(value);
      }
    }
  }
  return { compounds, referenceTypes };
}

/**
 * Whether the theme styles the element: a rule selects an element of its
 * classes and attribute values, of its tag or any. An element without
 * either, which every theme styles by its tag, is never told apart.
 */
export function stylesElement(
  markup: ThemeMarkup,
  element: ElementSelector,
): boolean {
  const classes = element.classes ?? [];
  const match = Object.entries(element.match ?? {});
  if (classes.length === 0 && match.length === 0) {
    return false;
  }
  const tag = element.tag.toLowerCase();
  return markup.compounds.some(
    (compound) =>
      (compound.tag === null || compound.tag === tag) &&
      classes.every((name) => compound.classes.includes(name)) &&
      match.every(([name, value]) =>
        compound.attributes.some(
          (it) => it.name === name && (it.value === null || it.value === value),
        ),
      ),
  );
}

export const EMPTY_THEME_MARKUP: ThemeMarkup = {
  compounds: [],
  referenceTypes: new Set(),
};
