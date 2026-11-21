import { describe, expect, it } from 'vitest';

import {
  buildThemeVariableSchema,
  loadThemeVariableSchema,
} from '../../libs/theme-variables';
import {
  buildSettingsRows,
  findSection,
  groupKey,
  isFiltering,
  matchSettings,
  type SettingsMatchInput,
  subgroupKey,
} from './rows';

const v = (syntax = '<length>') => ({ _syntax: syntax });

const schema = buildThemeVariableSchema({
  '_meta-properties': {
    'font-family': v('*'),
    'color-foreground': v('<color>'),
    'color-background': v('<color>'),
  },
  page: { 'margin-top': v(), 'margin-bottom': v(), size: v('*') },
  _basic: { 'h1-font-size': v(), 'h1-margin': v(), 'p-text-indent': v() },
});

const labels: Record<string, string> = {
  '_meta-properties': 'General',
  page: 'Page',
  _basic: 'Elements',
};

function match(overrides: Partial<SettingsMatchInput> = {}) {
  return matchSettings({
    groups: schema.groups,
    scope: 'root',
    filter: { query: '', modifiedOnly: false },
    isModified: () => false,
    getGroupLabel: (id) => labels[id],
    ...overrides,
  });
}

const keys = (
  input: Partial<SettingsMatchInput>,
  section: string | null = null,
  limit = 100,
) => buildSettingsRows(match(input), section, limit).map((row) => row.key);

describe('matchSettings', () => {
  it('lists the groups and their subgroups with counts', () => {
    const { toc, matchCount } = match();
    expect(
      toc.map((g) => [g.label, g.count, g.subgroups.map((s) => s.label)]),
    ).toEqual([
      ['General', 3, ['Color']],
      ['Page', 3, ['Margin']],
      ['Elements', 3, ['H1']],
    ]);
    expect(matchCount).toBe(9);
  });

  it('hides the groups a page scope does not apply', () => {
    expect(match({ scope: 'page-left' }).toc.map((g) => g.key)).toEqual([
      'g:page',
    ]);
  });

  it('matches every query token against name, key, group and label', () => {
    const query = (q: string) =>
      keys({ filter: { query: q, modifiedOnly: false } });
    expect(query('COLOR fore')).toEqual([
      'g:_meta-properties',
      's:_meta-properties/color',
      '--vs-color-foreground',
    ]);
    expect(query('elements indent')).toEqual([
      'g:_basic',
      '--vs--p-text-indent',
    ]);
    expect(query('--vs-page--size')).toEqual(['g:page', '--vs-page--size']);
  });

  it('drops the sections left without matches', () => {
    const { toc } = match({ filter: { query: 'h1', modifiedOnly: false } });
    expect(toc).toMatchObject([
      { key: 'g:_basic', count: 2, subgroups: [{ key: 's:_basic/h1' }] },
    ]);
  });

  it('filters and counts modified variables', () => {
    const modified = new Set(['--vs--h1-margin', '--vs-page--size']);
    const isModified = (name: string) => modified.has(name);
    const { toc, matchCount } = match({
      filter: { query: '', modifiedOnly: true },
      isModified,
    });
    expect(matchCount).toBe(2);
    expect(toc).toMatchObject([
      { key: 'g:page', count: 1, modified: 1, subgroups: [] },
      {
        key: 'g:_basic',
        count: 1,
        modified: 1,
        subgroups: [{ key: 's:_basic/h1', count: 1, modified: 1 }],
      },
    ]);
  });

  it('reports modified counts without the filter', () => {
    const { toc } = match({ isModified: (n) => n === '--vs--h1-margin' });
    expect(toc.at(-1)).toMatchObject({
      count: 3,
      modified: 1,
      subgroups: [{ count: 2, modified: 1 }],
    });
  });

  it('finds a group or a subgroup by its key', () => {
    const { toc } = match();
    expect(findSection(toc, groupKey('page'))?.label).toBe('Page');
    expect(findSection(toc, subgroupKey('page', 'margin'))?.label).toBe(
      'Margin',
    );
    expect(findSection(toc, subgroupKey('page', 'missing'))).toBeUndefined();
  });
});

describe('buildSettingsRows', () => {
  it('lists every match without a section', () => {
    expect(keys({})).toEqual([
      'g:_meta-properties',
      '--vs-font-family',
      's:_meta-properties/color',
      '--vs-color-foreground',
      '--vs-color-background',
      'g:page',
      '--vs-page--size',
      's:page/margin',
      '--vs-page--margin-top',
      '--vs-page--margin-bottom',
      'g:_basic',
      '--vs--p-text-indent',
      's:_basic/h1',
      '--vs--h1-font-size',
      '--vs--h1-margin',
    ]);
  });

  it('lists a group with its ungrouped variables first', () => {
    expect(keys({}, groupKey('page'))).toEqual([
      'g:page',
      '--vs-page--size',
      's:page/margin',
      '--vs-page--margin-top',
      '--vs-page--margin-bottom',
    ]);
  });

  it('lists only the subgroup under its group header', () => {
    expect(keys({}, subgroupKey('page', 'margin'))).toEqual([
      'g:page',
      's:page/margin',
      '--vs-page--margin-top',
      '--vs-page--margin-bottom',
    ]);
  });

  it('caps the variable rows and reports the rest', () => {
    const rows = buildSettingsRows(match(), null, 2);
    expect(rows.map((r) => r.key)).toEqual([
      'g:_meta-properties',
      '--vs-font-family',
      's:_meta-properties/color',
      '--vs-color-foreground',
      'more',
    ]);
    expect(rows.at(-1)).toEqual({ kind: 'more', key: 'more', remaining: 7 });
  });

  it('does not leave a header without its variables at the cap', () => {
    expect(keys({}, groupKey('page'), 1)).toEqual([
      'g:page',
      '--vs-page--size',
      'more',
    ]);
  });

  it('keeps the real schema fast enough to rebuild per keystroke', async () => {
    const real = await loadThemeVariableSchema();
    const started = performance.now();
    const matches = matchSettings({
      groups: real.groups,
      scope: 'root',
      filter: { query: 'color', modifiedOnly: false },
      isModified: () => false,
      getGroupLabel: (id) => id,
    });
    const rows = buildSettingsRows(matches, null, 150);
    expect(performance.now() - started).toBeLessThan(200);
    expect(matches.matchCount).toBeGreaterThan(150);
    expect(rows.filter((r) => r.kind === 'variable')).toHaveLength(150);
  });
});

describe('isFiltering', () => {
  it.each([
    [{ query: '', modifiedOnly: false }, false],
    [{ query: '  ', modifiedOnly: false }, false],
    [{ query: 'x', modifiedOnly: false }, true],
    [{ query: '', modifiedOnly: true }, true],
  ])('%j → %s', (filter, expected) => {
    expect(isFiltering(filter)).toBe(expected);
  });
});
