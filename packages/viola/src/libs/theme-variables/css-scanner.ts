export type CssDiagnosticCode =
  | 'unterminated-comment'
  | 'unterminated-string'
  | 'unclosed-block';

export interface CssDiagnostic {
  code: CssDiagnosticCode;
  offset: number;
}

export interface CssBlock {
  /** Offset of `{`. */
  open: number;
  /** Offset of the matching `}`, or the end of input when `closed` is false. */
  close: number;
  closed: boolean;
}

export interface CssRule {
  type: 'rule';
  /** Lower-cased at-keyword without `@`, or `null` for a qualified rule. */
  atName: string | null;
  prelude: string;
  start: number;
  end: number;
  block: CssBlock | null;
  /** False when the input ended before a `;` or a block closed the rule. */
  terminated: boolean;
}

export interface CssDeclaration {
  type: 'declaration';
  name: string;
  start: number;
  /** After the `;` when `terminated`, otherwise after the last value token. */
  end: number;
  /** Value range without surrounding whitespace, comments and `!important`. */
  valueStart: number;
  valueEnd: number;
  important: boolean;
  terminated: boolean;
  /** The value holds a top-level `!`, `)` or `]`, which voids the declaration. */
  malformed: boolean;
}

export type CssBlockItem = CssRule | CssDeclaration;

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function isWhitespace(c: string | undefined): boolean {
  return c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
}

function isNameChar(c: string | undefined): boolean {
  return c !== undefined && (/[-\w]/.test(c) || c > '\u007f');
}

/**
 * Tokenizer-level scanner following the error recovery of CSS Syntax Level 3:
 * it never throws and every offset refers to the original text, so callers can
 * patch the source without reserializing it.
 */
export class CssScanner {
  readonly css: string;
  readonly #diagnostics = new Map<string, CssDiagnostic>();

  constructor(css: string) {
    this.css = css;
  }

  get diagnostics(): CssDiagnostic[] {
    return [...this.#diagnostics.values()].sort((a, b) => a.offset - b.offset);
  }

  // Block contents are scanned again after the enclosing block was matched,
  // so the same problem is reported more than once.
  #report(code: CssDiagnosticCode, offset: number): void {
    this.#diagnostics.set(`${code}:${offset}`, { code, offset });
  }

  #skipComment(i: number): number {
    const close = this.css.indexOf('*/', i + 2);
    if (close === -1) {
      this.#report('unterminated-comment', i);
      return this.css.length;
    }
    return close + 2;
  }

  #skipString(i: number): number {
    const { css } = this;
    const quote = css[i];
    for (let j = i + 1; j < css.length; j++) {
      const c = css[j];
      if (c === '\\') {
        j += css[j + 1] === '\r' && css[j + 2] === '\n' ? 2 : 1;
      } else if (c === quote) {
        return j + 1;
      } else if (c === '\n' || c === '\r' || c === '\f') {
        this.#report('unterminated-string', i);
        return j;
      }
    }
    this.#report('unterminated-string', i);
    return css.length;
  }

  /**
   * An unquoted `url(` is a single token whose content is not tokenized, so
   * `;`, `/*` or quotes inside it must not be interpreted.
   */
  #matchUrl(i: number): number {
    const { css } = this;
    if (
      css.slice(i, i + 4).toLowerCase() !== 'url(' ||
      isNameChar(css[i - 1])
    ) {
      return -1;
    }
    let j = i + 4;
    while (isWhitespace(css[j])) {
      j++;
    }
    if (css[j] === '"' || css[j] === "'") {
      return -1;
    }
    for (; j < css.length; j++) {
      if (css[j] === '\\') {
        j++;
      } else if (css[j] === ')') {
        return j + 1;
      }
    }
    this.#report('unclosed-block', i + 3);
    return css.length;
  }

  // Iterative, so that deeply nested brackets cannot exhaust the call stack.
  #matchBlock(i: number): { end: number; closed: boolean } {
    const { css } = this;
    const open = [i];
    let j = i + 1;
    while (j < css.length) {
      const c = css[j];
      if (c === CLOSERS[css[open.at(-1) ?? i]]) {
        open.pop();
        j++;
        if (open.length === 0) {
          return { end: j, closed: true };
        }
      } else if (c === '(' || c === '[' || c === '{') {
        open.push(j++);
      } else {
        j = this.#skipToken(j);
      }
    }
    for (const offset of open) {
      this.#report('unclosed-block', offset);
    }
    return { end: css.length, closed: false };
  }

  #skipToken(i: number): number {
    const { css } = this;
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      return this.#skipComment(i);
    }
    if (c === '"' || c === "'") {
      return this.#skipString(i);
    }
    if (c === '\\') {
      return Math.min(i + 2, css.length);
    }
    if (c === 'u' || c === 'U') {
      const end = this.#matchUrl(i);
      if (end !== -1) {
        return end;
      }
    }
    return i + 1;
  }

  #skipComponent(i: number): number {
    const c = this.css[i];
    return c === '(' || c === '[' || c === '{'
      ? this.#matchBlock(i).end
      : this.#skipToken(i);
  }

  #skipTrivia(i: number, end: number, extra: readonly string[]): number {
    const { css } = this;
    let j = i;
    while (j < end) {
      const token = extra.find((t) => css.startsWith(t, j));
      if (token) {
        j += token.length;
      } else if (isWhitespace(css[j])) {
        j++;
      } else if (css[j] === '/' && css[j + 1] === '*') {
        j = this.#skipComment(j);
      } else {
        break;
      }
    }
    return Math.min(j, end);
  }

  #blockRule(
    atName: string | null,
    start: number,
    preludeStart: number,
    open: number,
  ): CssRule {
    const { end, closed } = this.#matchBlock(open);
    return {
      type: 'rule',
      atName,
      prelude: this.css.slice(preludeStart, open),
      start,
      end,
      block: { open, close: closed ? end - 1 : end, closed },
      terminated: true,
    };
  }

  #blocklessRule(
    atName: string | null,
    start: number,
    preludeStart: number,
    preludeEnd: number,
    terminated: boolean,
  ): CssRule {
    const prelude = this.css.slice(preludeStart, preludeEnd);
    return {
      type: 'rule',
      atName,
      prelude,
      start,
      end: terminated
        ? preludeEnd + 1
        : preludeStart + prelude.trimEnd().length,
      block: null,
      terminated,
    };
  }

  #scanAtRule(start: number, end: number): CssRule {
    const { css } = this;
    let i = start + 1;
    while (i < end && isNameChar(css[i])) {
      i++;
    }
    const atName = css.slice(start + 1, i).toLowerCase();
    const preludeStart = i;
    while (i < end) {
      if (css[i] === ';') {
        return this.#blocklessRule(atName, start, preludeStart, i, true);
      }
      if (css[i] === '{') {
        return this.#blockRule(atName, start, preludeStart, i);
      }
      i = this.#skipComponent(i);
    }
    return this.#blocklessRule(atName, start, preludeStart, end, false);
  }

  #scanQualifiedRule(start: number, end: number, nested: boolean): CssRule {
    const { css } = this;
    let i = start;
    while (i < end) {
      if (css[i] === '{') {
        return this.#blockRule(null, start, start, i);
      }
      // Only inside a block does `;` end a rule that never got its block; at
      // the top level it stays part of the prelude.
      if (nested && css[i] === ';') {
        return this.#blocklessRule(null, start, start, i, true);
      }
      i = this.#skipComponent(i);
    }
    return this.#blocklessRule(null, start, start, end, false);
  }

  /** Consumes a word, a whole function or any other component value. */
  #skipValueToken(i: number): number {
    const { css } = this;
    const isWordChar = (c: string | undefined) =>
      isNameChar(c) || (c !== undefined && '\\.%#+'.includes(c));
    if (!isWordChar(css[i])) {
      return this.#skipComponent(i);
    }
    let j = i;
    while (j < css.length && isWordChar(css[j])) {
      // Checked at every `u` to stay in step with `#skipComponent`.
      const url = css[j] === 'u' || css[j] === 'U' ? this.#matchUrl(j) : -1;
      if (url !== -1) {
        return j === i ? url : j;
      }
      j += css[j] === '\\' ? 2 : 1;
    }
    return css[j] === '(' ? this.#matchBlock(j).end : j;
  }

  #scanDeclaration(start: number, end: number): CssDeclaration | null {
    const { css } = this;
    let i = start;
    while (i < end && (isNameChar(css[i]) || css[i] === '\\')) {
      i += css[i] === '\\' ? 2 : 1;
    }
    if (i === start) {
      return null;
    }
    const name = css.slice(start, i);
    const colon = this.#skipTrivia(i, end, []);
    if (css[colon] !== ':' || colon >= end) {
      return null;
    }
    const custom = name.startsWith('--');
    const spans: { start: number; end: number }[] = [];
    i = colon + 1;
    while (i < end && css[i] !== ';') {
      const c = css[i];
      // `a:hover { … }` starts like a declaration; a custom property instead
      // takes a `{}` block as part of its value.
      if (c === '{' && !custom) {
        return null;
      }
      if (isWhitespace(c)) {
        i++;
        continue;
      }
      if (c === '/' && css[i + 1] === '*') {
        i = this.#skipComment(i);
        continue;
      }
      const spanStart = i;
      i = Math.min(this.#skipValueToken(i), end);
      spans.push({ start: spanStart, end: i });
    }
    const terminated = i < end;
    const text = (span: { start: number; end: number } | undefined) =>
      span ? css.slice(span.start, span.end) : '';
    const important =
      text(spans.at(-2)) === '!' &&
      text(spans.at(-1)).toLowerCase() === 'important';
    const valueSpans = important ? spans.slice(0, -2) : spans;
    const valueStart = valueSpans[0]?.start ?? colon + 1;
    const malformed = valueSpans.some((span) =>
      ['!', ')', ']'].includes(text(span)),
    );
    return {
      type: 'declaration',
      name,
      start,
      end: terminated ? i + 1 : (spans.at(-1)?.end ?? colon + 1),
      valueStart,
      valueEnd: valueSpans.at(-1)?.end ?? valueStart,
      important,
      terminated,
      malformed,
    };
  }

  /** Splits the input, taken as a declaration value, into component values. */
  scanValue(): string[] {
    const { css } = this;
    const tokens: string[] = [];
    let i = 0;
    while (true) {
      i = this.#skipTrivia(i, css.length, []);
      if (i >= css.length) {
        return tokens;
      }
      const end = this.#skipValueToken(i);
      tokens.push(css.slice(i, end));
      i = end;
    }
  }

  scanStylesheet(): CssRule[] {
    const { css } = this;
    const rules: CssRule[] = [];
    // A byte order mark is not part of the first rule's prelude.
    let i = css.startsWith('\ufeff') ? 1 : 0;
    while (true) {
      i = this.#skipTrivia(i, css.length, ['<!--', '-->']);
      if (i >= css.length) {
        return rules;
      }
      const rule =
        css[i] === '@'
          ? this.#scanAtRule(i, css.length)
          : this.#scanQualifiedRule(i, css.length, false);
      rules.push(rule);
      i = Math.max(rule.end, i + 1);
    }
  }

  /** Scans the contents of a `{}` block: declarations and nested rules. */
  scanBlock(block: CssBlock): CssBlockItem[] {
    const { css } = this;
    const end = block.close;
    const items: CssBlockItem[] = [];
    let i = block.open + 1;
    while (true) {
      i = this.#skipTrivia(i, end, [';']);
      if (i >= end) {
        return items;
      }
      const item =
        css[i] === '@'
          ? this.#scanAtRule(i, end)
          : (this.#scanDeclaration(i, end) ??
            this.#scanQualifiedRule(i, end, true));
      items.push(item);
      i = Math.max(item.end, i + 1);
    }
  }
}

/**
 * Whether `value` can be written as a declaration value without escaping its
 * declaration: no top-level `;` or `!`, balanced brackets, closed strings and
 * comments.
 */
export function isSafeDeclarationValue(value: string): boolean {
  const scanner = new CssScanner(`{--x:${value}}`);
  const [rule] = scanner.scanStylesheet();
  if (scanner.diagnostics.length > 0 || rule?.end !== scanner.css.length) {
    return false;
  }
  const items = rule.block ? scanner.scanBlock(rule.block) : [];
  const [declaration] = items;
  return (
    items.length === 1 &&
    declaration.type === 'declaration' &&
    !declaration.terminated &&
    !declaration.important &&
    !declaration.malformed
  );
}
