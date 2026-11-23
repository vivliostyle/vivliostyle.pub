import { type CssBlockItem, CssScanner } from './css-scanner';
import type { ThemeVariableSchema } from './schema';
import { getThemeScope, type ThemeScopeId } from './scopes';

type Specificity = readonly [number, number, number];

type Medium = 'print' | 'screen' | null;

interface ThemeDeclaration {
  value: string;
  important: boolean;
  target: 'element' | 'page';
  /** Selector list, with nesting resolved, or the prelude of `@page`. */
  selector: string;
  /** Query lists of the enclosing `@media` rules; all of them must match. */
  media: readonly string[];
  /** Index among its siblings of each enclosing cascade layer. */
  layer: readonly number[];
  order: number;
}

export interface ThemeDeclarations {
  /** Custom property declarations by name, in source order. */
  readonly byName: ReadonlyMap<string, readonly ThemeDeclaration[]>;
}

export interface ThemeDefaultsOptions {
  schema: ThemeVariableSchema;
  /** Declarations of the installed theme, from `scanThemeDeclarations`. */
  theme?: ThemeDeclarations;
  /** Language of the document, which `:lang()` is matched against. */
  language?: string;
  scope: ThemeScopeId;
}

interface ScopeContext {
  medium: Medium;
  /** Page pseudo-classes of a page scope, `null` for an element scope. */
  page: ReadonlySet<string> | null;
}

interface WalkContext {
  target: ThemeDeclaration['target'] | null;
  selector: string;
  media: readonly string[];
  layer: readonly number[];
  layerPath: string;
}

const UNLAYERED = Number.POSITIVE_INFINITY;

const NAME = /^(?:[-\w\u0080-￿]|\\[\s\S])+/;
const NUMBER = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/i;
const WORD = /^(?:[-\w\u0080-￿#]|\\[\s\S])+/;
const LEGACY_PSEUDO_ELEMENT = /^(?:before|after|first-line|first-letter)$/;

function skipString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === text[start]) {
      return i + 1;
    }
  }
  return text.length;
}

/** Offset of the bracket closing the one at `open`, or the end of `text`. */
function findClose(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
    } else if (c === '"' || c === "'") {
      i = skipString(text, i) - 1;
    } else if (c === '(' || c === '[') {
      depth++;
    } else if ((c === ')' || c === ']') && --depth === 0) {
      return i;
    }
  }
  return text.length;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
    } else if (c === '"' || c === "'") {
      i = skipString(text, i) - 1;
    } else if (c === '(' || c === '[') {
      i = findClose(text, i);
    } else if (c === ',') {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function cleanPrelude(prelude: string): string {
  return prelude
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unquote(text: string): string {
  const quote = text[0];
  const quoted =
    text.length >= 2 &&
    (quote === '"' || quote === "'") &&
    text.endsWith(quote);
  return (quoted ? text.slice(1, -1) : text).replace(/\\(.)/g, '$1');
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function maxSpecificity(list: readonly Specificity[]): Specificity | null {
  return list.reduce<Specificity | null>(
    (max, s) => (max && compareSpecificity(max, s) >= 0 ? max : s),
    null,
  );
}

// Unlayered declarations win over layered ones, and within a layer the
// declarations of the layer itself win over its sublayers.
function compareLayers(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; ; i++) {
    const x = a[i] ?? UNLAYERED;
    const y = b[i] ?? UNLAYERED;
    if (x !== y) {
      return x < y ? -1 : 1;
    }
    if (x === UNLAYERED) {
      return 0;
    }
  }
}

/** Extended filtering of RFC 4647, which Selectors Level 4 uses for `:lang()`. */
export function matchesLanguageRange(language: string, range: string): boolean {
  const tag = language.toLowerCase().split('-');
  const subtags = range.toLowerCase().split('-');
  if (subtags[0] !== '*' && subtags[0] !== tag[0]) {
    return false;
  }
  let t = 1;
  for (let r = 1; r < subtags.length; ) {
    if (subtags[r] === '*') {
      r++;
    } else if (t >= tag.length) {
      return false;
    } else if (tag[t] === subtags[r]) {
      t++;
      r++;
    } else if (tag[t].length === 1) {
      return false;
    } else {
      t++;
    }
  }
  return true;
}

interface SelectorMatch {
  matches: boolean;
  specificity: Specificity;
}

function evaluateSelectorList(
  list: string,
  language: string | undefined,
): SelectorMatch[] {
  return splitTopLevel(list).map((s) => evaluateSelector(s, language));
}

/**
 * Whether a selector matches the root element of a document that has no
 * other markup to go by than its language.
 */
function evaluateSelector(
  selector: string,
  language: string | undefined,
): SelectorMatch {
  let matches = selector !== '';
  let [ids, classes, types] = [0, 0, 0];
  const add = ([a, b, c]: Specificity) => {
    ids += a;
    classes += b;
    types += c;
  };
  let i = 0;
  while (i < selector.length) {
    const c = selector[i];
    const name = selector.slice(i).match(NAME)?.[0];
    if (c === '*') {
      i++;
    } else if (name) {
      add([0, 0, 1]);
      matches &&= name.toLowerCase() === 'html';
      i += name.length;
    } else if (c === '#' || c === '.') {
      const ident = selector.slice(i + 1).match(NAME)?.[0] ?? '';
      add(c === '#' ? [1, 0, 0] : [0, 1, 0]);
      matches = false;
      i += 1 + ident.length;
    } else if (c === '[') {
      add([0, 1, 0]);
      matches = false;
      i = findClose(selector, i) + 1;
    } else if (c === ':') {
      const element = selector[i + 1] === ':';
      const start = i + (element ? 2 : 1);
      const ident = selector.slice(start).match(NAME)?.[0] ?? '';
      i = start + ident.length;
      let args = '';
      if (selector[i] === '(') {
        const close = findClose(selector, i);
        args = selector.slice(i + 1, close);
        i = close + 1;
      }
      const pseudo = element ? '' : ident.toLowerCase();
      if (pseudo === 'root') {
        add([0, 1, 0]);
      } else if (pseudo === 'lang') {
        add([0, 1, 0]);
        matches &&=
          !!language &&
          splitTopLevel(args).some((range) =>
            matchesLanguageRange(language, unquote(range)),
          );
      } else if (pseudo === 'is' || pseudo === 'where' || pseudo === 'not') {
        const inner = evaluateSelectorList(args, language);
        if (pseudo !== 'where') {
          add(maxSpecificity(inner.map((m) => m.specificity)) ?? [0, 0, 0]);
        }
        const some = inner.some((m) => m.matches);
        matches &&= pseudo === 'not' ? !some : some;
      } else {
        add(
          element || LEGACY_PSEUDO_ELEMENT.test(pseudo) ? [0, 0, 1] : [0, 1, 0],
        );
        matches = false;
      }
    } else {
      // A combinator needs ancestors or siblings, which the root lacks; `&`
      // and namespaces are not resolved.
      matches = false;
      i++;
    }
  }
  return { matches, specificity: [ids, classes, types] };
}

function evaluatePageSelectorList(
  list: string,
  pseudos: ReadonlySet<string>,
): Specificity | null {
  const matching: Specificity[] = [];
  for (const selector of splitTopLevel(list)) {
    const name = selector.match(NAME)?.[0] ?? '';
    const rest = selector.slice(name.length);
    if (rest !== '' && !rest.startsWith(':')) {
      continue;
    }
    const classes = rest
      .split(':')
      .slice(1)
      .map((p) => p.replace(/\(.*$/, '').toLowerCase());
    // A page type name never matches, as no scope edits a named page.
    if (name === '' && classes.every((p) => pseudos.has(p))) {
      matching.push([
        0,
        classes.filter((p) => p === 'first' || p === 'blank' || p === 'nth')
          .length,
        classes.filter((p) => p === 'left' || p === 'right').length,
      ]);
    }
  }
  return maxSpecificity(matching);
}

function matchesMediaQueryList(list: string, medium: Medium): boolean {
  if (list === '') {
    return true;
  }
  return splitTopLevel(list.toLowerCase()).some((query) => {
    // Media features depend on the viewport and so never count as a default.
    const match = query.match(/^(?:(only|not) )?([a-z-]+)$/);
    if (!match) {
      return false;
    }
    const typeMatches = match[2] === 'all' || match[2] === medium;
    return match[1] === 'not' ? medium !== null && !typeMatches : typeMatches;
  });
}

function nestSelector(selector: string, parent: string): string {
  return splitTopLevel(selector)
    .map((part) =>
      part.includes('&')
        ? part.replaceAll('&', `:is(${parent})`)
        : `:is(${parent}) ${part}`,
    )
    .join(',');
}

function createLayerRegistry() {
  const siblings = new Map<string, Map<string, number>>();
  let anonymous = 0;
  return (
    { layer, layerPath }: Pick<WalkContext, 'layer' | 'layerPath'>,
    name: string,
  ): Pick<WalkContext, 'layer' | 'layerPath'> => {
    const parts = name === '' ? [`\0${anonymous++}`] : name.split('.');
    let path = layerPath;
    const indices = [...layer];
    for (const part of parts) {
      let names = siblings.get(path);
      if (!names) {
        names = new Map();
        siblings.set(path, names);
      }
      if (!names.has(part)) {
        names.set(part, names.size);
      }
      indices.push(names.get(part) ?? 0);
      path = `${path}.${part}`;
    }
    return { layer: indices, layerPath: path };
  };
}

function collectDeclarations(css: string): ThemeDeclarations {
  const scanner = new CssScanner(css);
  const byName = new Map<string, ThemeDeclaration[]>();
  const enterLayer = createLayerRegistry();
  let order = 0;

  const walk = (items: CssBlockItem[], context: WalkContext) => {
    for (const item of items) {
      if (item.type === 'declaration') {
        if (context.target && item.name.startsWith('--') && !item.malformed) {
          let list = byName.get(item.name);
          if (!list) {
            list = [];
            byName.set(item.name, list);
          }
          list.push({
            value: css.slice(item.valueStart, item.valueEnd),
            important: item.important,
            target: context.target,
            selector: context.selector,
            media: context.media,
            layer: context.layer,
            order: order++,
          });
        }
        continue;
      }
      const prelude = cleanPrelude(item.prelude);
      if (item.atName === 'layer') {
        const names = splitTopLevel(prelude);
        if (item.block) {
          walk(scanner.scanBlock(item.block), {
            ...context,
            ...enterLayer(context, names[0]),
          });
        } else {
          for (const name of names) {
            enterLayer(context, name);
          }
        }
        continue;
      }
      if (!item.block) {
        continue;
      }
      const block = scanner.scanBlock(item.block);
      if (item.atName === 'media') {
        walk(block, { ...context, media: [...context.media, prelude] });
      } else if (item.atName === 'page' && context.target === null) {
        walk(block, { ...context, target: 'page', selector: prelude });
      } else if (item.atName === null && context.target !== 'page') {
        walk(block, {
          ...context,
          target: 'element',
          selector:
            context.target === 'element'
              ? nestSelector(prelude, context.selector)
              : prelude,
        });
      }
      // Other at-rules hold no style declarations or, like `@supports`, make
      // them depend on what the renderer cannot be asked about here.
    }
  };

  walk(scanner.scanStylesheet(), {
    target: null,
    selector: '',
    media: [],
    layer: [],
    layerPath: '',
  });
  return { byName };
}

let lastScan: { css: string; declarations: ThemeDeclarations } | undefined;

/**
 * Collects the custom property declarations of a stylesheet. The result for
 * the last stylesheet is kept, as every mount of the editor asks for the same
 * theme bundle again.
 */
export function scanThemeDeclarations(css: string): ThemeDeclarations {
  if (lastScan?.css !== css) {
    lastScan = { css, declarations: collectDeclarations(css) };
  }
  return lastScan.declarations;
}

const schemaDeclarations = new WeakMap<
  ThemeVariableSchema,
  ThemeDeclarations
>();

// `define.css` declares the unconditional defaults ahead of the conditional
// ones, which is the order the cascade has to see them in.
function getSchemaDeclarations(schema: ThemeVariableSchema): ThemeDeclarations {
  let declarations = schemaDeclarations.get(schema);
  if (!declarations) {
    const byName = new Map(
      schema.variables.map(({ name, defaultValue, conditionalDefaults }) => [
        name,
        [
          ...(defaultValue === undefined ? [] : [{ value: defaultValue }]),
          ...conditionalDefaults,
        ].map(
          ({ value, selector, media }, order): ThemeDeclaration => ({
            value,
            important: false,
            target: 'element',
            selector: selector ?? ':root',
            media: media ? [media] : [],
            layer: [],
            order,
          }),
        ),
      ]),
    );
    declarations = { byName };
    schemaDeclarations.set(schema, declarations);
  }
  return declarations;
}

function getScopeContext(id: ThemeScopeId): ScopeContext {
  const { rule, media } = getThemeScope(id);
  if (!rule.startsWith('@page')) {
    return { medium: media, page: null };
  }
  const pseudos = rule
    .slice('@page'.length)
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean);
  // Pages only exist in paged rendering, for which Vivliostyle matches
  // `print`; a page context inherits from the root element.
  return { medium: 'print', page: new Set(pseudos) };
}

function memoize<T>(memo: Map<string, T>, key: string, compute: () => T): T {
  if (!memo.has(key)) {
    memo.set(key, compute());
  }
  return memo.get(key) as T;
}

function createCascade(
  { byName }: ThemeDeclarations,
  { medium, page }: ScopeContext,
  language: string | undefined,
): (name: string) => string | undefined {
  const mediaMemo = new Map<string, boolean>();
  const selectorMemo = new Map<string, Specificity | null>();
  const specificityOf = ({ target, selector }: ThemeDeclaration) =>
    memoize(selectorMemo, `${target}\n${selector}`, () =>
      target === 'page'
        ? evaluatePageSelectorList(selector, page ?? new Set())
        : maxSpecificity(
            evaluateSelectorList(selector, language)
              .filter((m) => m.matches)
              .map((m) => m.specificity),
          ),
    );

  const pick = (
    declarations: readonly ThemeDeclaration[],
    target: ThemeDeclaration['target'],
  ) => {
    let winner: RankedDeclaration | undefined;
    for (const declaration of declarations) {
      if (
        declaration.target !== target ||
        !declaration.media.every((list) =>
          memoize(mediaMemo, list, () => matchesMediaQueryList(list, medium)),
        )
      ) {
        continue;
      }
      const specificity = specificityOf(declaration);
      const ranked = specificity && { declaration, specificity };
      if (ranked && (!winner || compareCascade(ranked, winner) > 0)) {
        winner = ranked;
      }
    }
    return winner?.declaration.value;
  };

  return (name) => {
    const declarations = byName.get(name);
    if (!declarations) {
      return undefined;
    }
    return (
      (page ? pick(declarations, 'page') : undefined) ??
      pick(declarations, 'element')
    );
  };
}

interface RankedDeclaration {
  declaration: ThemeDeclaration;
  specificity: Specificity;
}

function compareCascade(a: RankedDeclaration, b: RankedDeclaration): number {
  const { important } = a.declaration;
  if (important !== b.declaration.important) {
    return important ? 1 : -1;
  }
  const layers = compareLayers(a.declaration.layer, b.declaration.layer);
  if (layers !== 0) {
    return important ? -layers : layers;
  }
  return (
    compareSpecificity(a.specificity, b.specificity) ||
    a.declaration.order - b.declaration.order
  );
}

// Escapes are consumed as pairs so that the quote after `\\` is not taken
// for an escaped one.
function requoteStringBody(body: string): string {
  return body.replace(/\\([\s\S])|"/g, (match, escaped?: string) => {
    if (escaped === "'") {
      return "'";
    }
    return match === '"' ? '\\"' : match;
  });
}

/**
 * A form of a value that does not change with how lightningcss minifies the
 * bundle: `0.5em` becomes `.5em`, `'a'` becomes `"a"` and `var(--a, b)`
 * becomes `var(--a,b)`.
 */
function normalizeValue(value: string): string {
  let out = '';
  let space = false;
  let i = 0;
  while (i < value.length) {
    const c = value[i];
    if (/\s/.test(c)) {
      space = true;
      i++;
      continue;
    }
    const rest = value.slice(i);
    const number = rest.match(NUMBER)?.[0];
    let token: string;
    if (c === '"' || c === "'") {
      const end = skipString(value, i);
      const body = value.slice(
        i + 1,
        end > i + 1 && value[end - 1] === c ? end - 1 : end,
      );
      token = `"${requoteStringBody(body)}"`;
      i = end;
    } else if (number) {
      const sign = /^[+-]/.test(number) ? number[0] : '';
      token = `${sign}${Number(number.replace(/^[+-]/, ''))}`;
      i += number.length;
    } else {
      token = rest.match(WORD)?.[0] ?? c;
      i += token.length;
    }
    const glued = token === ',' || token === ')' || /[,(]$/.test(out);
    out += space && out !== '' && !glued ? ` ${token}` : token;
    space = false;
  }
  return out;
}

function resolveDefaults(
  { schema, theme, language }: Omit<ThemeDefaultsOptions, 'scope'>,
  context: ScopeContext,
): (name: string) => string | undefined {
  const documented = createCascade(
    getSchemaDeclarations(schema),
    context,
    language,
  );
  const declared = theme && createCascade(theme, context, language);
  const memo = new Map<string, string | undefined>();
  return (name) =>
    memoize(memo, name, () => {
      const fromSchema = documented(name);
      const fromTheme = declared?.(name);
      return fromTheme === undefined ||
        (fromSchema !== undefined &&
          normalizeValue(fromTheme) === normalizeValue(fromSchema))
        ? fromSchema
        : fromTheme;
    });
}

/**
 * The value each variable takes in `scope` when no user stylesheet sets it:
 * what the cascade of the installed theme yields, else what theme-base
 * documents. A theme value equal to the documented one is reported in the
 * documented form, which reads better than the minified bundle.
 */
export function resolveThemeDefaults({
  scope,
  ...options
}: ThemeDefaultsOptions): (name: string) => string | undefined {
  return resolveDefaults(options, getScopeContext(scope));
}

/**
 * Like `resolveThemeDefaults`, for a page that every one of `pageClasses`
 * matches at once, such as the first page, which is a right page as well.
 */
export function resolvePageDefaults({
  pageClasses,
  ...options
}: Omit<ThemeDefaultsOptions, 'scope'> & {
  pageClasses: readonly string[];
}): (name: string) => string | undefined {
  return resolveDefaults(options, {
    medium: 'print',
    page: new Set(pageClasses),
  });
}
