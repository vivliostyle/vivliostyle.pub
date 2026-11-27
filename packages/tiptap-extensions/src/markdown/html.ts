import { decodeString } from 'micromark-util-decode-string';

/**
 * HTML as VFM keeps it in markdown, read the way a browser's tokenizer reads
 * tags, so the editor reads an element as VFM's HTML does.
 */

export interface StartTag {
  /** Lower-cased. */
  name: string;
  /** By lower-cased name, the first of each, with references read. */
  attributes: Record<string, string>;
  /** Where the tag ends, after its `>`. */
  end: number;
}

function isWhitespace(char: string | undefined): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f'
  );
}

function isAsciiLetter(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z]$/.test(char);
}

function isAlphanumeric(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z0-9]$/.test(char);
}

// Code points a numeric reference means something else for in HTML than in
// markdown, or nothing: the windows-1252 remapping, surrogates and NUL.
function isUnsafeCodePoint(code: number): boolean {
  return (
    code === 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff) ||
    (code >= 0x80 && code <= 0x9f)
  );
}

/**
 * HTML text or an attribute value with its character references read, or
 * null where a reference is one that HTML and markdown read differently,
 * such as one without its `;`: the element is then kept as written. A
 * backslash is a character of its own in HTML, so it escapes nothing.
 */
export function decodeHtml(text: string): string | null {
  if (!text.includes('&')) {
    return text;
  }
  let result = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char !== '&') {
      result += char;
      i++;
      continue;
    }
    if (text[i + 1] === '#') {
      const hex = text[i + 2] === 'x' || text[i + 2] === 'X';
      let j = i + (hex ? 3 : 2);
      const digits = j;
      while (
        j < text.length &&
        /[0-9A-Fa-f]/.test(text[j]) &&
        (hex || /\d/.test(text[j]))
      ) {
        j++;
      }
      if (j === digits || text[j] !== ';') {
        return null;
      }
      const code = Number.parseInt(text.slice(digits, j), hex ? 16 : 10);
      if (isUnsafeCodePoint(code)) {
        return null;
      }
      result += String.fromCodePoint(code);
      i = j + 1;
      continue;
    }
    let j = i + 1;
    while (j < text.length && isAlphanumeric(text[j])) {
      j++;
    }
    if (j === i + 1) {
      result += char;
      i++;
      continue;
    }
    // Some names are read without their `;`, and differently by HTML in
    // attributes, so only a reference with it is read.
    if (text[j] !== ';') {
      return null;
    }
    result += decodeString(text.slice(i, j + 1));
    i = j + 1;
  }
  return result;
}

/** HTML text that reads back as `text`. */
export function encodeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\r/g, '&#13;');
}

/** An attribute value, quoted with `"`, that reads back as `value`. */
export function encodeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/**
 * The start tag at `start`, which holds a `<`, or null where there is none
 * or one of its values holds a reference that cannot be read safely.
 */
export function readStartTag(text: string, start: number): StartTag | null {
  if (text[start] !== '<' || !isAsciiLetter(text[start + 1])) {
    return null;
  }
  let i = start + 1;
  while (
    i < text.length &&
    !isWhitespace(text[i]) &&
    text[i] !== '/' &&
    text[i] !== '>'
  ) {
    i++;
  }
  const name = text.slice(start + 1, i).toLowerCase();
  const attributes: Record<string, string> = {};
  while (i < text.length) {
    while (isWhitespace(text[i]) || text[i] === '/') {
      i++;
    }
    if (i >= text.length) {
      return null;
    }
    if (text[i] === '>') {
      return { name, attributes, end: i + 1 };
    }
    const nameStart = i;
    i++;
    while (
      i < text.length &&
      !isWhitespace(text[i]) &&
      text[i] !== '/' &&
      text[i] !== '>' &&
      text[i] !== '='
    ) {
      i++;
    }
    const attribute = text.slice(nameStart, i).toLowerCase();
    let j = i;
    while (isWhitespace(text[j])) {
      j++;
    }
    let value = '';
    if (text[j] === '=') {
      j++;
      while (isWhitespace(text[j])) {
        j++;
      }
      const quote = text[j];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, j + 1);
        if (close === -1) {
          return null;
        }
        value = text.slice(j + 1, close);
        i = close + 1;
      } else {
        const valueStart = j;
        while (j < text.length && !isWhitespace(text[j]) && text[j] !== '>') {
          j++;
        }
        value = text.slice(valueStart, j);
        i = j;
      }
      const decoded = decodeHtml(value);
      if (decoded === null) {
        return null;
      }
      value = decoded;
    }
    if (!(attribute in attributes)) {
      attributes[attribute] = value;
    }
  }
  return null;
}

/** The end tag at `start`, which holds a `<`, or null. */
export function readEndTag(
  text: string,
  start: number,
): { name: string; end: number } | null {
  if (
    text[start] !== '<' ||
    text[start + 1] !== '/' ||
    !isAsciiLetter(text[start + 2])
  ) {
    return null;
  }
  let i = start + 2;
  while (i < text.length && !isWhitespace(text[i]) && text[i] !== '>') {
    i++;
  }
  const name = text.slice(start + 2, i).toLowerCase();
  const close = text.indexOf('>', i);
  return close === -1 ? null : { name, end: close + 1 };
}

/** HTML that is one start tag, or null. */
export function readOpeningTag(value: string): StartTag | null {
  const text = value.trim();
  const tag = readStartTag(text, 0);
  return tag && tag.end === text.length ? tag : null;
}

/** HTML that is one end tag of the name. */
export function isEndTag(value: string | undefined, name: string): boolean {
  const text = value?.trim() ?? '';
  const tag = readEndTag(text, 0);
  return tag !== null && tag.end === text.length && tag.name === name;
}

/**
 * How many elements of the name the HTML opens, less those it closes, and
 * whether it closes one it did not open: null where a tag of the name cannot
 * be read, so what it pairs with is not known.
 */
export function tagBalance(
  value: string,
  name: string,
): { depth: number; low: number } | null {
  let depth = 0;
  let low = 0;
  let i = value.indexOf('<');
  while (i !== -1) {
    if (value.startsWith('<!--', i)) {
      const end = value.indexOf('-->', i + 4);
      if (end === -1) {
        return { depth, low };
      }
      i = value.indexOf('<', end + 3);
      continue;
    }
    const end = readEndTag(value, i);
    if (end) {
      if (end.name === name) {
        depth--;
        low = Math.min(low, depth);
      }
      i = value.indexOf('<', end.end);
      continue;
    }
    if (isAsciiLetter(value[i + 1])) {
      const tag = readStartTag(value, i);
      const tagName = value.slice(i + 1, i + 1 + name.length + 1).toLowerCase();
      if (!tag) {
        if (tagName.startsWith(name) && !isAlphanumeric(tagName[name.length])) {
          return null;
        }
        i = value.indexOf('<', i + 1);
        continue;
      }
      if (tag.name === name && value[tag.end - 2] !== '/') {
        depth++;
      }
      i = value.indexOf('<', tag.end);
      continue;
    }
    i = value.indexOf('<', i + 1);
  }
  return { depth, low };
}
