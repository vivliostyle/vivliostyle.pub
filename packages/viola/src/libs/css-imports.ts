import { dirname, join, normalize } from 'pathe';

export type CssImportTarget =
  | { kind: 'external'; specifier: string }
  | { kind: 'file'; specifier: string; path: string }
  | {
      kind: 'package';
      specifier: string;
      packageName: string;
      /** What to hand to the registry: `name` or `name@version`. */
      installSpecifier: string;
    };

const isIdentChar = (char: string | undefined) =>
  char !== undefined && /[\w-]|[\u0080-￿]/.test(char);

function readString(css: string, start: number): [string, number] {
  const quote = css[start];
  let value = '';
  let i = start + 1;
  while (i < css.length && css[i] !== quote && css[i] !== '\n') {
    if (css[i] === '\\' && i + 1 < css.length) {
      i++;
    }
    value += css[i++];
  }
  return [value, i + 1];
}

function skipSpaceAndComments(css: string, start: number): number {
  let i = start;
  for (;;) {
    while (i < css.length && /\s/.test(css[i])) {
      i++;
    }
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
    } else {
      return i;
    }
  }
}

function readImportTarget(css: string, start: number): [string, number] | null {
  const i = skipSpaceAndComments(css, start);
  if (css[i] === '"' || css[i] === "'") {
    return readString(css, i);
  }
  if (/^url\(/i.test(css.slice(i, i + 4))) {
    const j = skipSpaceAndComments(css, i + 4);
    if (css[j] === '"' || css[j] === "'") {
      const [value, next] = readString(css, j);
      return [value, next];
    }
    const end = css.indexOf(')', j);
    if (end === -1) {
      return null;
    }
    return [css.slice(j, end).trim(), end + 1];
  }
  return null;
}

export interface CssImportRule {
  specifier: string;
  /** Source range of the whole rule, from `@import` through its `;`. */
  start: number;
  end: number;
}

function findRuleEnd(css: string, start: number): number {
  let i = start;
  let parens = 0;
  while (i < css.length) {
    const char = css[i];
    if (css.startsWith('/*', i)) {
      i = skipSpaceAndComments(css, i);
    } else if (char === '"' || char === "'") {
      i = readString(css, i)[1];
    } else if (char === '(') {
      parens++;
      i++;
    } else if (char === ')') {
      parens = Math.max(0, parens - 1);
      i++;
    } else if (char === ';' && parens === 0) {
      return i + 1;
    } else if ((char === '{' || char === '}') && parens === 0) {
      return i;
    } else {
      i++;
    }
  }
  return css.length;
}

/**
 * Returns top-level `@import` rules in source order. It is a tolerant
 * scanner rather than a parser, because the CSS is usually mid-edit.
 */
export function scanCssImports(css: string): CssImportRule[] {
  const rules: CssImportRule[] = [];
  let depth = 0;
  let i = 0;
  while (i < css.length) {
    const char = css[i];
    if (css.startsWith('/*', i)) {
      i = skipSpaceAndComments(css, i);
    } else if (char === '"' || char === "'") {
      i = readString(css, i)[1];
    } else if (char === '{') {
      depth++;
      i++;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (
      depth === 0 &&
      char === '@' &&
      css.slice(i + 1, i + 7).toLowerCase() === 'import' &&
      !isIdentChar(css[i + 7])
    ) {
      const target = readImportTarget(css, i + 7);
      if (target?.[0]) {
        const end = findRuleEnd(css, target[1]);
        rules.push({ specifier: target[0], start: i, end });
        i = Math.max(end, i + 7);
      } else {
        i = target ? target[1] : i + 7;
      }
    } else {
      i++;
    }
  }
  return rules;
}

export const extractCssImportSpecifiers = (css: string): string[] =>
  scanCssImports(css).map((rule) => rule.specifier);

const packageSpecifierPattern =
  /^(?<name>@[^/@]+\/[^/@]+|[^@/.][^/@]*)(?:@(?<version>[^/]+))?(?:\/.*)?$/;

/**
 * `importer` is the project path of the stylesheet containing the import.
 * A bare specifier naming an existing project `.css` file is a file, as in
 * `@vivliostyle/cli`.
 */
export function classifyCssImport(
  specifier: string,
  importer: string,
  isProjectFile: (path: string) => boolean,
): CssImportTarget | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(specifier)) {
    return { kind: 'external', specifier };
  }
  const clean = specifier.replace(/[?#].*$/, '');
  const path = normalize(join(dirname(importer), clean));
  const insideProject = !path.startsWith('../') && path !== '..';
  if (clean.startsWith('.')) {
    return insideProject ? { kind: 'file', specifier, path } : undefined;
  }
  if (insideProject && clean.endsWith('.css') && isProjectFile(path)) {
    return { kind: 'file', specifier, path };
  }
  const { name, version } = clean.match(packageSpecifierPattern)?.groups ?? {};
  if (!name) {
    return undefined;
  }
  return {
    kind: 'package',
    specifier,
    packageName: name,
    installSpecifier: version ? `${name}@${version}` : name,
  };
}
