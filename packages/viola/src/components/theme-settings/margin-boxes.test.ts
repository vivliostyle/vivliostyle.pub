import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { loadThemeVariableSchema } from '../../libs/theme-variables';
import {
  ALL_MARGIN_BOXES,
  findSpreadSideBox,
  getCellsSharing,
  getSpreadContentFallback,
  getSpreadSideBox,
  getSpreadSideVariables,
  MARGIN_BOX_CELLS,
  SPREAD_SIDE_BOXES,
} from './margin-boxes';

const require = createRequire(import.meta.url);
const pageCss = readFileSync(
  require.resolve('@vivliostyle/theme-base/page'),
  'utf8',
);

function bodyFrom(css: string, open: number): string {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') {
      depth++;
    } else if (css[i] === '}' && --depth === 0) {
      return css.slice(open + 1, i);
    }
  }
  throw new Error('Unclosed block');
}

/** The bodies of the blocks that a prelude opens, at the start of a line. */
function blocks(css: string, prelude: string): string[] {
  const escaped = prelude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`^\\s*${escaped} \\{`, 'gm'))].map(
    (match) => bodyFrom(css, (match.index ?? 0) + match[0].length - 1),
  );
}

/** The declarations of a margin box inside the page rules of a prelude. */
const marginBox = (page: string, id: string) =>
  blocks(pageCss, page)
    .flatMap((body) => blocks(body, `@${id.slice('mbox-'.length)}`))
    .join('\n');

describe('MARGIN_BOX_CELLS', () => {
  it('falls back to the boxes that theme-base falls back to', async () => {
    const schema = await loadThemeVariableSchema();
    const targetOf = new Map(
      schema.variables.flatMap((v) =>
        v.group === 'page' && v.subgroup.kind === 'target'
          ? [[v.name, v.subgroup.id]]
          : [],
      ),
    );
    for (const cell of MARGIN_BOX_CELLS) {
      const names = marginBox('@page', cell.id).match(/--vs-page--[\w-]+/g);
      const referenced = new Set(
        names?.flatMap((name) => targetOf.get(name) ?? []),
      );
      referenced.delete(cell.id);
      expect([...referenced].sort(), cell.id).toEqual(
        [...cell.fallbacks].sort(),
      );
    }
  });
});

describe('getSpreadContentFallback', () => {
  it.each([
    'left',
    'right',
  ] as const)('names the variable theme-base falls back to on a %s page', (page) => {
    for (const cell of MARGIN_BOX_CELLS) {
      const declared = marginBox(`@page :${page}`, cell.id).match(
        /var\(\s*--vs-page--[\w-]+,\s*var\((--vs-page--[\w-]+)\)/,
      )?.[1];
      expect(getSpreadContentFallback(cell, page), cell.id).toBe(
        declared ?? null,
      );
    }
  });
});

describe('spread side boxes', () => {
  it('take every content of theme-base that a side of a spread shows', async () => {
    const schema = await loadThemeVariableSchema();
    const names = schema.variables
      .map((v) => v.name)
      .filter((name) =>
        /^--vs-page--mbox-.*(?:inside|outside).*-content$/.test(name),
      );
    expect(names).not.toHaveLength(0);
    for (const name of names) {
      const box = findSpreadSideBox(name);
      expect(box, name).not.toBeNull();
      expect(getSpreadSideVariables(box ?? '')).toContain(name);
      expect(schema.byName.get(name)?.subgroup.id, name).toMatch(
        /^mbox(?:-top|-bottom)?$/,
      );
    }
  });

  it('gather an edge with its corners, and the side edges together', () => {
    expect(SPREAD_SIDE_BOXES).toHaveLength(6);
    expect(getSpreadSideVariables('mbox-top-outside')).toEqual(
      expect.arrayContaining([
        '--vs-page--mbox-top-outside-content',
        '--vs-page--mbox-top-outside-corner-content',
      ]),
    );
    expect(getSpreadSideBox('left', 'inside')).toBe('mbox-inside');
    expect(getSpreadSideBox('right', 'inside')).toBe('mbox-inside');
    expect([...getSpreadSideVariables('mbox-inside')].sort()).toEqual([
      '--vs-page--mbox-inside-bottom-content',
      '--vs-page--mbox-inside-middle-content',
      '--vs-page--mbox-inside-top-content',
    ]);
  });
});

describe('getCellsSharing', () => {
  it('lists the cells that fall back to a shared box', () => {
    expect(getCellsSharing(ALL_MARGIN_BOXES)).toHaveLength(16);
    expect(getCellsSharing('mbox-top').map((c) => c.id)).toEqual([
      'mbox-top-left-corner',
      'mbox-top-left',
      'mbox-top-center',
      'mbox-top-right',
      'mbox-top-right-corner',
    ]);
    expect(getCellsSharing('mbox-left-inner').map((c) => c.id)).toEqual([
      'mbox-top-left',
      'mbox-bottom-left',
    ]);
  });
});
