import { describe, expect, it } from 'vitest';

import {
  buildThemeVariableSchema,
  loadThemeVariableSchema,
} from '../../libs/theme-variables';
import {
  buildSettingsRows,
  groupKey,
  isFiltering,
  type SettingsRowsInput,
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

function build(overrides: Partial<SettingsRowsInput> = {}) {
  return buildSettingsRows({
    groups: schema.groups,
    scope: 'root',
    filter: { query: '', modifiedOnly: false },
    isModified: () => false,
    isExpanded: () => false,
    limit: 100,
    getGroupLabel: (id) => labels[id],
    ...overrides,
  });
}

const keys = (input: Partial<SettingsRowsInput>) =>
  build(input).rows.map((row) => row.key);

describe('buildSettingsRows', () => {
  it('shows only group headers when collapsed', () => {
    const { rows, matchCount } = build();
    expect(rows.map((r) => r.kind === 'group' && [r.label, r.count])).toEqual([
      ['General', 3],
      ['Page', 3],
      ['Elements', 3],
    ]);
    expect(matchCount).toBe(9);
  });

  it('lists the ungrouped variables, then the subgroup headers', () => {
    expect(
      keys({ isExpanded: (key) => key === groupKey('_meta-properties') }),
    ).toEqual([
      'g:_meta-properties',
      '--vs-font-family',
      's:_meta-properties/color',
      'g:page',
      'g:_basic',
    ]);
  });

  it('expands a subgroup', () => {
    const expanded = new Set([groupKey('page'), subgroupKey('page', 'margin')]);
    const { rows } = build({ isExpanded: (key) => expanded.has(key) });
    expect(rows.map((r) => r.key)).toEqual([
      'g:_meta-properties',
      'g:page',
      '--vs-page--size',
      's:page/margin',
      '--vs-page--margin-top',
      '--vs-page--margin-bottom',
      'g:_basic',
    ]);
    expect(rows.find((r) => r.key === '--vs-page--margin-top')).toMatchObject({
      nested: true,
    });
  });

  it('hides the groups a page scope does not apply', () => {
    expect(keys({ scope: 'page-left' })).toEqual(['g:page']);
  });

  it('matches every query token against name, key, group and label', () => {
    const all = () => true;
    expect(
      keys({
        filter: { query: 'COLOR fore', modifiedOnly: false },
        isExpanded: all,
      }),
    ).toEqual([
      'g:_meta-properties',
      's:_meta-properties/color',
      '--vs-color-foreground',
    ]);
    expect(
      keys({
        filter: { query: 'elements indent', modifiedOnly: false },
        isExpanded: all,
      }),
    ).toEqual(['g:_basic', '--vs--p-text-indent']);
    expect(
      keys({
        filter: { query: '--vs-page--size', modifiedOnly: false },
        isExpanded: all,
      }),
    ).toEqual(['g:page', '--vs-page--size']);
  });

  it('filters and counts modified variables', () => {
    const modified = new Set(['--vs--h1-margin', '--vs-page--size']);
    const { rows, matchCount } = build({
      filter: { query: '', modifiedOnly: true },
      isModified: (name) => modified.has(name),
      isExpanded: () => true,
    });
    expect(matchCount).toBe(2);
    expect(rows.map((r) => r.key)).toEqual([
      'g:page',
      '--vs-page--size',
      'g:_basic',
      's:_basic/h1',
      '--vs--h1-margin',
    ]);
    expect(rows[0]).toMatchObject({ count: 1, modified: 1 });
  });

  it('reports modified counts without the filter', () => {
    const { rows } = build({ isModified: (n) => n === '--vs--h1-margin' });
    expect(rows.at(-1)).toMatchObject({ count: 3, modified: 1 });
  });

  it('caps the variable rows and reports the rest', () => {
    const { rows } = build({ isExpanded: () => true, limit: 2 });
    expect(rows.map((r) => r.key)).toEqual([
      'g:_meta-properties',
      '--vs-font-family',
      's:_meta-properties/color',
      '--vs-color-foreground',
      'more',
    ]);
    expect(rows.at(-1)).toEqual({ kind: 'more', key: 'more', remaining: 7 });
  });

  it('still offers more when only collapsed headers are cut', () => {
    const { rows } = build({
      isExpanded: (key) => key === groupKey('page'),
      limit: 1,
    });
    expect(rows.map((r) => r.key)).toEqual([
      'g:_meta-properties',
      'g:page',
      '--vs-page--size',
      'more',
    ]);
  });

  it('keeps the real schema fast enough to rebuild per keystroke', async () => {
    const real = await loadThemeVariableSchema();
    const started = performance.now();
    const { rows, matchCount } = buildSettingsRows({
      groups: real.groups,
      scope: 'root',
      filter: { query: 'color', modifiedOnly: false },
      isModified: () => false,
      isExpanded: () => true,
      limit: 150,
      getGroupLabel: (id) => id,
    });
    expect(performance.now() - started).toBeLessThan(200);
    expect(matchCount).toBeGreaterThan(150);
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
