import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

import {
  compoundSelectors,
  readStyledMarkup,
  stylesElement,
} from './stylesheet-selectors';

const themeBase = dirname(
  createRequire(import.meta.url).resolve(
    '@vivliostyle/theme-base/package.json',
  ),
);

/** A stylesheet of the package with its relative imports inlined. */
function bundle(path: string): string {
  const css = readFileSync(join(themeBase, path), 'utf8');
  return css.replace(/@import url\(([^)]+)\);/g, (_, imported: string) =>
    bundle(join(dirname(path), imported)),
  );
}

// The modules a theme imports on top of `theme.css`, as the official themes
// built on it do.
const MODULES = [
  'appendix',
  'citation',
  'endnote',
  'equation',
  'figure',
  'footnote',
  'listing',
  'math',
  'page',
  'section',
  'sidenote',
  'table',
  'theorem',
  'toc',
];
const moduleCss = (name: string) => bundle(`css/${name}/index.css`);

describe('compound selectors', () => {
  it.each([
    ['.footnote::footnote-call', [{ tag: null, classes: ['footnote'] }]],
    [
      "a[data-ref='fig']::before, .x > p",
      [
        { tag: 'a', attributes: [{ name: 'data-ref', value: 'fig' }] },
        { tag: null, classes: ['x'] },
        { tag: 'p' },
      ],
    ],
    [
      'figure:where(.tbl, :has(table)) figcaption',
      [{ tag: 'figure', classes: ['tbl'] }, { tag: 'figcaption' }],
    ],
    [
      'a:is([data-ref=\'cite\'], [role="doc-biblioref"])',
      [
        {
          tag: 'a',
          attributes: [
            { name: 'data-ref', value: 'cite' },
            { name: 'role', value: 'doc-biblioref' },
          ],
        },
      ],
    ],
    [
      ":not(.footnote) > a[href^='http']::after",
      [{ tag: 'a', classes: [], attributes: [{ name: 'href', value: null }] }],
    ],
    [
      '.theorem:where(:not(:has(> p:only-child)))::before',
      [{ tag: null, classes: ['theorem'] }],
    ],
    [
      'section:has(> h1.appendix)',
      [{ tag: 'h1', classes: ['appendix'] }, { tag: 'section' }],
    ],
    [
      '.a\\:b, .\\31 x, [class~="c d"]',
      [{ classes: ['a:b'] }, { classes: ['1x'] }, { classes: ['c', 'd'] }],
    ],
    [
      'svg|a, *|*[data-ref=x i]',
      [{ tag: 'a' }, { attributes: [{ name: 'data-ref', value: 'x' }] }],
    ],
  ])('%s', (selector, expected) => {
    expect(compoundSelectors(selector)).toMatchObject(expected);
  });
});

describe('the markup a theme styles', () => {
  it('finds rules inside at-rules and nested rules, not in comments', () => {
    const markup = readStyledMarkup(`
      /* .comment {} */
      @media print { @supports (float: footnote) { .footnote { float: footnote } } }
      @layer base { .tcy { text-combine-upright: all } }
      @page { @top-center { content: "x" } }
      .wrap { & .note { color: red } }
    `);
    for (const name of ['footnote', 'tcy', 'note']) {
      expect(stylesElement(markup, { tag: 'span', classes: [name] })).toBe(
        true,
      );
    }
    expect(stylesElement(markup, { tag: 'span', classes: ['comment'] })).toBe(
      false,
    );
  });

  it('tells nothing of an element without classes or attribute values', () => {
    const markup = readStyledMarkup('figcaption { color: red }');
    expect(stylesElement(markup, { tag: 'figcaption' })).toBe(false);
  });

  it('needs the tag to match where the rule names one', () => {
    const markup = readStyledMarkup('div.note { color: red }');
    expect(stylesElement(markup, { tag: 'div', classes: ['note'] })).toBe(true);
    expect(stylesElement(markup, { tag: 'span', classes: ['note'] })).toBe(
      false,
    );
  });

  it('reads deeply nested CSS without running out of stack or time', () => {
    const start = Date.now();
    const selectors = `${':is('.repeat(8000)}.a${')'.repeat(8000)} {}`;
    const blocks = `${'.b {'.repeat(5000)}${'}'.repeat(5000)}`;
    const markup = readStyledMarkup(`${selectors}\n${blocks}\n.c {}`);
    expect(stylesElement(markup, { tag: 'span', classes: ['b'] })).toBe(true);
    expect(stylesElement(markup, { tag: 'span', classes: ['c'] })).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('survives broken CSS', () => {
    const markup = readStyledMarkup('.a { color: red; .b { "unclosed } [x');
    expect(stylesElement(markup, { tag: 'span', classes: ['a'] })).toBe(true);
  });
});

describe('@vivliostyle/theme-base', () => {
  it('styles none of the markup without its modules', () => {
    const markup = readStyledMarkup(bundle('theme.css'));
    expect([...markup.referenceTypes]).toEqual([]);
    for (const name of ['footnote', 'sidenote', 'equation', 'fig-caption']) {
      expect(stylesElement(markup, { tag: 'span', classes: [name] })).toBe(
        false,
      );
    }
  });

  it('styles the markup of each module', () => {
    const expected: Record<
      string,
      { classes: [string, string][]; references: string[] }
    > = {
      appendix: { classes: [['h1', 'appendix']], references: ['appendix'] },
      citation: { classes: [['ol', 'cite-items']], references: ['cite'] },
      equation: { classes: [['div', 'equation']], references: ['eq'] },
      figure: { classes: [['p', 'fig-caption']], references: ['fig'] },
      footnote: { classes: [['span', 'footnote']], references: [] },
      listing: { classes: [['p', 'lst-caption']], references: ['lst'] },
      page: { classes: [], references: ['page'] },
      section: { classes: [], references: ['sec'] },
      sidenote: { classes: [['aside', 'sidenote']], references: ['sidenote'] },
      table: {
        classes: [
          ['p', 'tbl-caption'],
          ['figure', 'tbl'],
        ],
        references: ['tbl'],
      },
      theorem: { classes: [['div', 'theorem']], references: ['thm'] },
    };
    for (const [name, { classes, references }] of Object.entries(expected)) {
      const markup = readStyledMarkup(moduleCss(name));
      expect([...markup.referenceTypes].sort(), name).toEqual(references);
      for (const [tag, className] of classes) {
        expect(
          stylesElement(markup, { tag, classes: [className] }),
          `${name}: ${tag}.${className}`,
        ).toBe(true);
      }
    }
  });

  it('styles every reference type with all its modules', () => {
    const markup = readStyledMarkup(
      [bundle('theme.css'), ...MODULES.map(moduleCss)].join('\n'),
    );
    expect([...markup.referenceTypes].sort()).toEqual([
      'appendix',
      'cite',
      'eq',
      'fig',
      'lst',
      'page',
      'sec',
      'sidenote',
      'tbl',
      'thm',
    ]);
    expect(stylesElement(markup, { tag: 'span', classes: ['tcy'] })).toBe(
      false,
    );
  });
});
