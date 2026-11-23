import { m } from '../../generated/paraglide/messages';
import type { ThemeCssModel, ThemeScopeId } from '../../libs/theme-variables';
import {
  getSpreadContentFallback,
  type MarginBoxCell,
  type SpreadPage,
} from './margin-boxes';

export interface ContentSamples {
  page: number;
  pages: number;
}

type Token =
  | { kind: 'string'; text: string }
  | { kind: 'ident'; name: string }
  | { kind: 'function'; name: string; args: string[] };

function tokenize(value: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < value.length) {
    const char = value[i];
    if (/\s/.test(char)) {
      i++;
    } else if (char === '"' || char === "'") {
      let text = '';
      i++;
      while (i < value.length && value[i] !== char) {
        if (value[i] === '\\' && i + 1 < value.length) {
          const hex = value.slice(i + 1).match(/^[0-9a-f]{1,6}\s?/i);
          text += hex
            ? String.fromCodePoint(Number.parseInt(hex[0], 16))
            : value[i + 1];
          i += 1 + (hex ? hex[0].length : 1);
        } else {
          text += value[i++];
        }
      }
      i++;
      tokens.push({ kind: 'string', text });
    } else {
      const ident = value.slice(i).match(/^-?[a-z_][\w-]*/i);
      if (!ident) {
        return null;
      }
      i += ident[0].length;
      if (value[i] !== '(') {
        tokens.push({ kind: 'ident', name: ident[0].toLowerCase() });
        continue;
      }
      const close = value.indexOf(')', i);
      if (close === -1) {
        return null;
      }
      tokens.push({
        kind: 'function',
        name: ident[0].toLowerCase(),
        args: value
          .slice(i + 1, close)
          .split(',')
          .map((arg) => arg.trim()),
      });
      i = close + 1;
    }
  }
  return tokens;
}

function previewToken(token: Token, samples: ContentSamples): string {
  switch (token.kind) {
    case 'string':
      return token.text;
    case 'ident':
      return '';
    case 'function': {
      const [first = ''] = token.args;
      if (token.name === 'counter' || token.name === 'counters') {
        if (first === 'page') {
          return String(samples.page);
        }
        if (first === 'pages') {
          return String(samples.pages);
        }
        return '1';
      }
      if (token.name === 'env') {
        if (first === 'pub-title') {
          return m.theme_settings_margin_boxes_sample_pub_title();
        }
        if (first === 'doc-title') {
          return m.theme_settings_margin_boxes_sample_doc_title();
        }
      }
      return `${token.name}(${token.args.join(', ')})`;
    }
  }
}

/**
 * What a margin box shows for a `content` value, with sample numbers and
 * titles in place of what only the typeset book knows, or `null` if it shows
 * nothing.
 */
export function previewContent(
  value: string | undefined,
  samples: ContentSamples,
): string | null {
  if (value === undefined) {
    return null;
  }
  const tokens = tokenize(value);
  if (tokens === null) {
    return value.trim() || null;
  }
  const text = tokens.map((token) => previewToken(token, samples)).join('');
  return text.trim() === '' ? null : text;
}

// Later scopes of the stylesheet win the cascade at equal specificity, and a
// page context inherits what the root element sets.
const SPREAD_SCOPES: Readonly<Record<SpreadPage, readonly ThemeScopeId[]>> = {
  left: ['page-left', 'page', 'print-root', 'root'],
  right: ['page-right', 'page', 'print-root', 'root'],
};

/**
 * The `content` value a cell takes on a page of a spread: its own, else the
 * one theme-base words by the inside or outside of the spread. Each is looked
 * up in the stylesheet's scopes that reach the page, then in the theme.
 */
export function getSpreadContent(
  cell: MarginBoxCell,
  page: SpreadPage,
  model: ThemeCssModel,
  getDefault: (page: SpreadPage, name: string) => string | undefined,
): string | undefined {
  const lookUp = (name: string) => {
    for (const scope of SPREAD_SCOPES[page]) {
      const value = model.scopes[scope].variables[name]?.value;
      if (value !== undefined) {
        return value;
      }
    }
    return getDefault(page, name);
  };
  const own = lookUp(`--vs-page--${cell.id}-content`);
  if (own !== undefined) {
    return own;
  }
  const fallback = getSpreadContentFallback(cell, page);
  return fallback === null ? undefined : lookUp(fallback);
}
