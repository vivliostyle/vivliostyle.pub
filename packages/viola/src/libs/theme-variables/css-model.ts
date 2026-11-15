import {
  type CssBlock,
  type CssDeclaration,
  type CssDiagnostic,
  type CssRule,
  CssScanner,
  isSafeDeclarationValue,
} from './css-scanner';
import { getThemeScope, THEME_SCOPES, type ThemeScopeId } from './scopes';

export interface ThemeCssVariable {
  name: string;
  /** Value text without surrounding whitespace, comments and `!important`. */
  value: string;
  important: boolean;
  /** Source range of the effective declaration. */
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  /** How many times the scope declares this variable. */
  count: number;
}

export interface ThemeCssScope {
  exists: boolean;
  /** Effective custom property declarations by name. */
  variables: Record<string, ThemeCssVariable>;
}

export interface ThemeCssModel {
  scopes: Record<ThemeScopeId, ThemeCssScope>;
  /** Syntax problems found anywhere in the stylesheet. */
  diagnostics: CssDiagnostic[];
}

export type ThemeCssEditErrorCode =
  | 'invalid-name'
  | 'invalid-value'
  | 'unsafe-edit';

export class ThemeCssEditError extends Error {
  readonly code: ThemeCssEditErrorCode;

  constructor(code: ThemeCssEditErrorCode) {
    super(`Cannot edit theme CSS: ${code}`);
    this.name = 'ThemeCssEditError';
    this.code = code;
  }
}

interface ScopeRule {
  rule: CssRule;
  block: CssBlock;
  /** The top-level rule: `rule` itself, or the `@media` rule wrapping it. */
  container: CssRule;
  declarations: CssDeclaration[];
}

interface Analysis {
  scanner: CssScanner;
  rules: CssRule[];
  scopes: Record<ThemeScopeId, ScopeRule[]>;
}

const PAGE_SCOPES: Record<string, ThemeScopeId> = {
  '': 'page',
  ':left': 'page-left',
  ':right': 'page-right',
  ':first': 'page-first',
};

const MEDIA_SCOPES: Record<string, ThemeScopeId> = {
  print: 'print-root',
  screen: 'screen-root',
};

const PROLOGUE_AT_RULES = new Set(['charset', 'import', 'namespace', 'layer']);

const CUSTOM_PROPERTY_NAME = /^--[-\w\u0080-￿]+$/;

function normalizePrelude(prelude: string): string {
  return prelude
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function analyze(css: string): Analysis {
  const scanner = new CssScanner(css);
  const rules = scanner.scanStylesheet();
  const scopes = Object.fromEntries(
    THEME_SCOPES.map((scope) => [scope.id, [] as ScopeRule[]]),
  ) as Record<ThemeScopeId, ScopeRule[]>;

  const add = (id: ThemeScopeId, rule: CssRule, container: CssRule) => {
    if (!rule.block) {
      return;
    }
    const declarations = scanner
      .scanBlock(rule.block)
      .filter(
        (item): item is CssDeclaration =>
          item.type === 'declaration' && item.name.startsWith('--'),
      );
    scopes[id].push({ rule, block: rule.block, container, declarations });
  };
  const isRoot = (rule: CssRule) =>
    rule.atName === null && normalizePrelude(rule.prelude) === ':root';

  for (const rule of rules) {
    if (!rule.block) {
      continue;
    }
    const prelude = normalizePrelude(rule.prelude);
    if (isRoot(rule)) {
      add('root', rule, rule);
    } else if (rule.atName === 'page' && Object.hasOwn(PAGE_SCOPES, prelude)) {
      add(PAGE_SCOPES[prelude], rule, rule);
    } else if (
      rule.atName === 'media' &&
      Object.hasOwn(MEDIA_SCOPES, prelude)
    ) {
      for (const item of scanner.scanBlock(rule.block)) {
        if (item.type === 'rule' && isRoot(item)) {
          add(MEDIA_SCOPES[prelude], item, rule);
        }
      }
    }
  }
  return { scanner, rules, scopes };
}

function findDeclarations(
  scopeRules: ScopeRule[],
  name: string,
): { scopeRule: ScopeRule; declaration: CssDeclaration }[] {
  return scopeRules.flatMap((scopeRule) =>
    scopeRule.declarations
      .filter((declaration) => declaration.name === name)
      .map((declaration) => ({ scopeRule, declaration })),
  );
}

function pickEffective<T extends { declaration: CssDeclaration }>(
  entries: T[],
): T | undefined {
  return entries.findLast((e) => e.declaration.important) ?? entries.at(-1);
}

export function parseThemeCss(css: string): ThemeCssModel {
  const { scanner, scopes } = analyze(css);
  const model = {} as Record<ThemeScopeId, ThemeCssScope>;
  for (const { id } of THEME_SCOPES) {
    const variables: Record<string, ThemeCssVariable> = {};
    const names = new Set(
      scopes[id].flatMap((r) => r.declarations.map((d) => d.name)),
    );
    for (const name of names) {
      const entries = findDeclarations(scopes[id], name);
      const { declaration } = pickEffective(entries) ?? entries[0];
      variables[name] = {
        name,
        value: css.slice(declaration.valueStart, declaration.valueEnd),
        important: declaration.important,
        start: declaration.start,
        end: declaration.end,
        valueStart: declaration.valueStart,
        valueEnd: declaration.valueEnd,
        count: entries.length,
      };
    }
    model[id] = { exists: scopes[id].length > 0, variables };
  }
  return { scopes: model, diagnostics: scanner.diagnostics };
}

function detectEol(css: string): string {
  return css.includes('\r\n') ? '\r\n' : '\n';
}

function detectIndentUnit(css: string): string {
  if (/^\t/m.test(css)) {
    return '\t';
  }
  return /^ {4}\S/m.test(css) && !/^ {2}\S/m.test(css) ? '    ' : '  ';
}

function isMinified(css: string): boolean {
  return /[{}]/.test(css) && !/[\r\n]|\s[{}]|[{}]\s/.test(css.trim());
}

function lineStartOf(css: string, offset: number): number {
  return css.lastIndexOf('\n', offset - 1) + 1;
}

function lineIndentOf(css: string, offset: number): string {
  return css.slice(lineStartOf(css, offset)).match(/^[ \t]*/)?.[0] ?? '';
}

/**
 * Range to cut for removing `[start, end)`: its whole lines when nothing else
 * shares them, otherwise the text and the inline whitespace that follows it.
 */
function removalRange(
  css: string,
  start: number,
  end: number,
): { from: number; to: number; ownLines: boolean } {
  const lineStart = lineStartOf(css, start);
  let to = end;
  while (css[to] === ' ' || css[to] === '\t') {
    to++;
  }
  const eol = css.startsWith('\r\n', to) ? 2 : css[to] === '\n' ? 1 : 0;
  const ownLines =
    css.slice(lineStart, start).trim() === '' && (eol > 0 || to === css.length);
  return ownLines
    ? { from: lineStart, to: to + eol, ownLines }
    : { from: start, to, ownLines };
}

function removeRule(css: string, start: number, end: number): string {
  let { from, to, ownLines } = removalRange(css, start, end);
  if (ownLines) {
    const blankBefore = css.slice(0, from).match(/(?:^|\n)([ \t]*\r?\n)$/);
    const blankAfter = css.slice(to).match(/^[ \t]*\r?\n/);
    // A rule is set off by blank lines; keep a single one where it stood.
    if (blankAfter && (from === 0 || blankBefore)) {
      to += blankAfter[0].length;
    } else if (blankBefore && css.slice(to).trim() === '') {
      from -= blankBefore[1].length;
    }
  }
  return css.slice(0, from) + css.slice(to);
}

function deleteDeclaration(
  css: string,
  { rule, block, container }: ScopeRule,
  declaration: CssDeclaration,
): string {
  const { from, to } = removalRange(css, declaration.start, declaration.end);
  const out = css.slice(0, from) + css.slice(to);
  const removed = to - from;
  const close = block.close - removed;
  if (!block.closed || out.slice(block.open + 1, close).trim() !== '') {
    return out;
  }
  const outer = container.block;
  if (container !== rule && outer?.closed) {
    const rest =
      out.slice(outer.open + 1, rule.start) +
      out.slice(close + 1, outer.close - removed);
    if (rest.trim() === '') {
      return removeRule(out, container.start, outer.close - removed + 1);
    }
  }
  return removeRule(out, rule.start, close + 1);
}

function insertDeclaration(
  css: string,
  { scanner }: Analysis,
  { rule, block }: ScopeRule,
  name: string,
  value: string,
): string {
  const { open, close, closed } = block;
  const eol = detectEol(css);
  const content = css.slice(open + 1, close);
  const body = content.trimEnd();
  const items = scanner.scanBlock(block);
  const last = items.at(-1);
  const innerIndent = () => {
    for (const item of items.toReversed()) {
      const lead = css.slice(lineStartOf(css, item.start), item.start);
      if (lead.trim() === '') {
        return lead;
      }
    }
    return lineIndentOf(css, rule.start) + detectIndentUnit(css);
  };

  let at = open + 1 + body.length;
  let until = at;
  let text: string;
  if (content.includes('\n')) {
    text = `${eol}${innerIndent()}${name}: ${value};`;
  } else if (body === '') {
    if (content === '' && isMinified(css)) {
      text = `${name}:${value}`;
    } else {
      at = open + 1;
      until = close;
      text = `${eol}${innerIndent()}${name}: ${value};${eol}`;
      if (closed) {
        text += lineIndentOf(css, rule.start);
      }
    }
  } else if (content === content.trim()) {
    text = `${name}:${value}${last?.terminated === false ? '' : ';'}`;
  } else {
    text = ` ${name}: ${value};`;
  }
  const out = css.slice(0, at) + text + css.slice(until);
  return last && !last.terminated
    ? `${out.slice(0, last.end)};${out.slice(last.end)}`
    : out;
}

/**
 * Offset after the statements that must stay first in a stylesheet, or after
 * the leading comments that a blank line detaches from the first rule.
 */
function findPrologueEnd(css: string, rules: CssRule[]): number {
  let end = 0;
  for (const rule of rules) {
    if (
      rule.atName === null ||
      rule.block ||
      !rule.terminated ||
      !PROLOGUE_AT_RULES.has(rule.atName)
    ) {
      break;
    }
    end = rule.end;
  }
  if (end > 0) {
    return end;
  }
  const leading = /\s*(\/\*[\s\S]*?\*\/)/y;
  for (let match = leading.exec(css); match; match = leading.exec(css)) {
    if (/^[ \t]*(\r?\n[ \t]*(\r?\n|$)|$)/.test(css.slice(leading.lastIndex))) {
      end = leading.lastIndex;
    }
  }
  return end;
}

/**
 * Start of the comment lines sitting directly above the rule at `start`, which
 * a rule inserted before it must not come between.
 */
function findAttachedCommentStart(
  css: string,
  rules: CssRule[],
  start: number,
): number {
  const previousEnd = rules.findLast((rule) => rule.end <= start)?.end ?? 0;
  const gap = css.slice(previousEnd, start);
  // What shares the line of the previous rule belongs to that rule; after
  // that, only a blank line outside of comments detaches.
  let detached = previousEnd > 0 ? gap.length : 0;
  let sawEol = previousEnd === 0;
  const tokens = gap.matchAll(/\/\*[\s\S]*?\*\/|\n[ \t]*\r?\n|\n/g);
  for (const { 0: token, index } of tokens) {
    if (token[0] === '\n' && (!sawEol || token.length > 1)) {
      detached = index + token.length;
    }
    sawEol ||= token[0] === '\n';
  }
  return start - gap.slice(detached).trimStart().length;
}

function insertRule(
  css: string,
  { rules, scopes }: Analysis,
  scopeId: ThemeScopeId,
  name: string,
  value: string,
): string {
  const { rule, media } = getThemeScope(scopeId);
  const eol = detectEol(css);
  const minified = isMinified(css);
  let text: string;
  if (minified) {
    text = `${rule}{${name}:${value}}`;
    text = media ? `@media ${media}{${text}}` : text;
  } else {
    const unit = detectIndentUnit(css);
    const pad = media ? unit : '';
    const lines = [
      `${pad}${rule} {`,
      `${pad}${unit}${name}: ${value};`,
      `${pad}}`,
    ];
    text = (media ? [`@media ${media} {`, ...lines, '}'] : lines).join(eol);
  }

  // Slot the rule in by scope order so `root` stays ahead of the `@media`
  // scopes that are meant to override it.
  const index = THEME_SCOPES.findIndex((scope) => scope.id === scopeId);
  const containersOf = (scopeList: readonly { id: ThemeScopeId }[]) =>
    scopeList.flatMap(({ id }) => scopes[id].map((r) => r.container));
  const preceding = containersOf(THEME_SCOPES.slice(0, index));
  const following = containersOf(THEME_SCOPES.slice(index + 1));

  if (preceding.length === 0 && following.length > 0) {
    const first = Math.min(...following.map((r) => r.start));
    const at = findAttachedCommentStart(css, rules, first);
    const separator = minified ? '' : eol + eol;
    return css.slice(0, at) + text + separator + css.slice(at);
  }
  const at =
    preceding.length > 0
      ? Math.max(...preceding.map((r) => r.end))
      : findPrologueEnd(css, rules);
  const head = css.slice(0, at);
  const tail = css.slice(at);
  if (minified) {
    return head + text + tail;
  }
  const prefix = head.trim() === '' ? '' : eol + eol;
  const leadingEols = tail.match(/^\s*/)?.[0].split('\n').length ?? 1;
  const suffix =
    tail.trim() === ''
      ? eol.repeat(leadingEols > 1 ? 0 : 1)
      : eol.repeat(Math.max(0, 3 - leadingEols));
  return head + prefix + text + suffix + tail;
}

function assertName(name: string): void {
  if (!CUSTOM_PROPERTY_NAME.test(name)) {
    throw new ThemeCssEditError('invalid-name');
  }
}

/** The form `parseThemeCss` reports a value in. */
function normalizeValue(value: string): string {
  const scanner = new CssScanner(`{--x:${value}}`);
  const [rule] = scanner.scanStylesheet();
  const [declaration] = rule?.block ? scanner.scanBlock(rule.block) : [];
  return declaration?.type === 'declaration'
    ? scanner.css.slice(declaration.valueStart, declaration.valueEnd)
    : '';
}

/**
 * Sets `name` in `scope`: updates the effective declaration in place and drops
 * shadowed duplicates, or creates the declaration and, if needed, its rule.
 * Throws `ThemeCssEditError` when the name, value or stylesheet prevents it.
 */
export function setVariable(
  css: string,
  scope: ThemeScopeId,
  name: string,
  value: string,
): string {
  assertName(name);
  if (!isSafeDeclarationValue(value)) {
    throw new ThemeCssEditError('invalid-value');
  }
  const text = normalizeValue(value);
  if (text === '') {
    throw new ThemeCssEditError('invalid-value');
  }

  let out = css;
  let analysis = analyze(out);
  let entries = findDeclarations(analysis.scopes[scope], name);
  while (entries.length > 1) {
    const effective = pickEffective(entries);
    const shadowed = entries.find((e) => e !== effective) ?? entries[0];
    out = deleteDeclaration(out, shadowed.scopeRule, shadowed.declaration);
    analysis = analyze(out);
    entries = findDeclarations(analysis.scopes[scope], name);
  }

  const [entry] = entries;
  const scopeRule = analysis.scopes[scope].at(-1);
  if (entry) {
    const { valueStart, valueEnd } = entry.declaration;
    const gap = valueStart === valueEnd && out[valueStart - 1] === ':';
    out = `${out.slice(0, valueStart)}${gap ? ' ' : ''}${text}${out.slice(valueEnd)}`;
  } else if (scopeRule) {
    out = insertDeclaration(out, analysis, scopeRule, name, text);
  } else {
    out = insertRule(out, analysis, scope, name, text);
  }

  // Unterminated comments, strings or blocks can swallow the edit; refuse
  // rather than hand back CSS that does not say what was asked for.
  if (parseThemeCss(out).scopes[scope].variables[name]?.value !== text) {
    throw new ThemeCssEditError('unsafe-edit');
  }
  return out;
}

/**
 * Removes every declaration of `name` in `scope`. A scope rule left without
 * any content is removed too.
 */
export function removeVariable(
  css: string,
  scope: ThemeScopeId,
  name: string,
): string {
  assertName(name);
  let out = css;
  while (true) {
    const entry = findDeclarations(analyze(out).scopes[scope], name).at(-1);
    if (!entry) {
      return out;
    }
    out = deleteDeclaration(out, entry.scopeRule, entry.declaration);
  }
}
