export interface NumericToken {
  /** Offset of the number, sign included. */
  start: number;
  /** Offset after the number, where its unit starts. */
  end: number;
  /** Offset after the unit; equals `end` for a bare number. */
  unitEnd: number;
  /** Bracket nesting depth; 0 for a top-level component value. */
  depth: number;
  number: string;
  /** `%`, a unit identifier, or empty. */
  unit: string;
}

export interface StepResult {
  text: string;
  /** Position of the stepped number among the numeric tokens of `text`. */
  index: number;
  /** Range of the stepped number, without its unit. */
  start: number;
  end: number;
}

const isDigit = (c: string | undefined) =>
  c !== undefined && c >= '0' && c <= '9';

const isNameStart = (c: string | undefined) =>
  c !== undefined && (/[a-z_]/i.test(c) || c > '\u007f');

const isNameChar = (c: string | undefined) =>
  c !== undefined && (/[-\w]/.test(c) || c > '\u007f');

const isEscape = (text: string, i: number) =>
  text[i] === '\\' && i + 1 < text.length && text[i + 1] !== '\n';

function startsNumber(text: string, i: number): boolean {
  const j = text[i] === '+' || text[i] === '-' ? i + 1 : i;
  return isDigit(text[j]) || (text[j] === '.' && isDigit(text[j + 1]));
}

function startsIdent(text: string, i: number): boolean {
  if (text[i] === '-') {
    return (
      isNameStart(text[i + 1]) || text[i + 1] === '-' || isEscape(text, i + 1)
    );
  }
  return isNameStart(text[i]) || isEscape(text, i);
}

function skipName(text: string, i: number): number {
  let j = i;
  while (j < text.length) {
    if (isEscape(text, j)) {
      j += 2;
    } else if (isNameChar(text[j])) {
      j++;
    } else {
      break;
    }
  }
  return Math.min(j, text.length);
}

function skipDigits(text: string, i: number): number {
  let j = i;
  while (isDigit(text[j])) {
    j++;
  }
  return j;
}

function skipNumber(text: string, i: number): number {
  let j = skipDigits(text, text[i] === '+' || text[i] === '-' ? i + 1 : i);
  if (text[j] === '.' && isDigit(text[j + 1])) {
    j = skipDigits(text, j + 1);
  }
  if (text[j] === 'e' || text[j] === 'E') {
    const k = text[j + 1] === '+' || text[j + 1] === '-' ? j + 2 : j + 1;
    if (isDigit(text[k])) {
      j = skipDigits(text, k);
    }
  }
  return j;
}

function skipString(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
    } else if (text[j] === text[i]) {
      return j + 1;
    }
  }
  return text.length;
}

/** `open` is the offset of `(` after `url`; `-1` when the URL is quoted. */
function skipUnquotedUrl(text: string, open: number): number {
  let j = open + 1;
  while (/\s/.test(text[j] ?? '')) {
    j++;
  }
  if (text[j] === '"' || text[j] === "'") {
    return -1;
  }
  for (; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
    } else if (text[j] === ')') {
      return j + 1;
    }
  }
  return text.length;
}

/**
 * The numbers of a CSS value, tokenized as CSS does, so that digits in an
 * identifier (`h1`, `--vs-x2`), a hash (`#fff000`), a string, a comment or a
 * URL are not numbers.
 */
export function findNumericTokens(text: string): NumericToken[] {
  const tokens: NumericToken[] = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
    } else if (c === '"' || c === "'") {
      i = skipString(text, i);
    } else if (startsNumber(text, i)) {
      const end = skipNumber(text, i);
      const unitEnd =
        text[end] === '%'
          ? end + 1
          : startsIdent(text, end)
            ? skipName(text, end)
            : end;
      tokens.push({
        start: i,
        end,
        unitEnd,
        depth,
        number: text.slice(i, end),
        unit: text.slice(end, unitEnd),
      });
      i = unitEnd;
    } else if (c === '#') {
      i = skipName(text, i + 1);
    } else if (startsIdent(text, i)) {
      const end = skipName(text, i);
      const url =
        text[end] === '(' && text.slice(i, end).toLowerCase() === 'url'
          ? skipUnquotedUrl(text, end)
          : -1;
      i = url === -1 ? end : url;
    } else {
      if (c === '(' || c === '[' || c === '{') {
        depth++;
      } else if ((c === ')' || c === ']' || c === '}') && depth > 0) {
        depth--;
      }
      i++;
    }
  }
  return tokens;
}

/**
 * The token a selection works on: one it overlaps, else one it touches, so
 * that a caret right after `10mm` still picks it.
 */
export function findTokenAt(
  tokens: readonly NumericToken[],
  selectionStart: number,
  selectionEnd: number,
): number {
  const overlapping = tokens.findIndex(
    (token) => token.start < selectionEnd && token.unitEnd > selectionStart,
  );
  return overlapping !== -1
    ? overlapping
    : tokens.findIndex(
        (token) =>
          token.start <= selectionEnd && token.unitEnd >= selectionStart,
      );
}

function countDecimals(number: string): number {
  const match = number.match(/^[+-]?\d*(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  return Math.max(0, (match?.[1]?.length ?? 0) - Number(match?.[2] ?? 0));
}

/**
 * `number + delta` at the precision of the two, computed on integers so that
 * `0.2 + 0.1` gives `0.3`; trailing zeros are dropped.
 */
export function addToNumber(number: string, delta: number): string | null {
  const value = Number(number);
  if (!Number.isFinite(value)) {
    return null;
  }
  const decimals = Math.min(
    Math.max(countDecimals(number), countDecimals(String(delta))),
    20,
  );
  const scale = 10 ** decimals;
  const scaled = Math.round(value * scale) + Math.round(delta * scale);
  if (!Number.isSafeInteger(scaled)) {
    return String(value + delta);
  }
  const fixed = (scaled / scale).toFixed(decimals);
  return fixed.includes('.')
    ? fixed.replace(/0+$/, '').replace(/\.$/, '')
    : fixed;
}

/** Range of the number of the `index`-th numeric token, without its unit. */
export function getNumberRange(
  text: string,
  index: number,
): { start: number; end: number } | null {
  const token = findNumericTokens(text)[index];
  return token ? { start: token.start, end: token.end } : null;
}

/** Adds `delta` to the `index`-th number, leaving the rest of `text` as is. */
export function stepNumber(
  text: string,
  index: number,
  delta: number,
): StepResult | null {
  const token = findNumericTokens(text)[index];
  const number = token ? addToNumber(token.number, delta) : null;
  if (!token || number === null) {
    return null;
  }
  return {
    text: text.slice(0, token.start) + number + text.slice(token.end),
    index,
    start: token.start,
    end: token.start + number.length,
  };
}

/** Steps the number under the caret or touched by the selection. */
export function stepNumberAt(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  delta: number,
): StepResult | null {
  const index = findTokenAt(
    findNumericTokens(text),
    selectionStart,
    selectionEnd,
  );
  return index === -1 ? null : stepNumber(text, index, delta);
}

/** Steps the first top-level number, e.g. of a default shown as placeholder. */
export function stepFirstNumber(
  text: string,
  delta: number,
): StepResult | null {
  const index = findNumericTokens(text).findIndex((token) => token.depth === 0);
  return index === -1 ? null : stepNumber(text, index, delta);
}

export interface StepKey {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * ±1, ±10 with Shift, ±0.1 with Alt/Option and ±0.01 with both. Ctrl and
 * Cmd keep their caret movement.
 */
export function getStepDelta({
  key,
  shiftKey,
  altKey,
  ctrlKey,
  metaKey,
}: StepKey): number | null {
  const sign = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
  if (sign === 0 || ctrlKey || metaKey) {
    return null;
  }
  const size = shiftKey && altKey ? 0.01 : shiftKey ? 10 : altKey ? 0.1 : 1;
  return sign * size;
}
