import { describe, expect, it } from 'vitest';

import {
  buildThemeVariableSchema,
  loadThemeVariableSchema,
  type ThemeVariableCategory,
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

const v = (property?: string) => ({ _syntax: '*', _property: property });

const schema = buildThemeVariableSchema({
  '_meta-properties': {
    'font-family': v('font-family'),
    'color-foreground': v(),
    'color-background': v(),
  },
  page: {
    'margin-top': v('margin-top'),
    'margin-bottom': v('margin-bottom'),
    size: v('size'),
  },
  _basic: {
    'h1-font-size': v('font-size'),
    'h1-margin-block': v('margin-block'),
    'p-text-indent': v('text-indent'),
  },
});

const labels: Record<string, string> = {
  '_meta-properties': 'General',
  page: 'Page',
  body: 'Body text',
  heading: 'Headings',
  section: 'Sections',
};

const categoryLabels: Partial<Record<ThemeVariableCategory, string>> = {
  font: 'Font',
  color: 'Color and background',
  'page-setup': 'Page size and marks',
  margin: 'Margin and padding',
};

const target = (id: string) => ({ kind: 'target', id }) as const;
const category = (id: ThemeVariableCategory) =>
  ({ kind: 'category', id }) as const;

function match(overrides: Partial<SettingsMatchInput> = {}) {
  return matchSettings({
    groups: schema.groups,
    scope: 'root',
    filter: { query: '', modifiedOnly: false },
    isModified: () => false,
    getGroupLabel: (id) => labels[id],
    getCategoryLabel: (id) => categoryLabels[id] ?? id,
    qualifyLabel: (module, label) => `${module}: ${label}`,
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
      ['General', 3, ['Font', 'Color and background']],
      ['Page', 3, ['Page size and marks', 'Margin and padding']],
      ['Body text', 1, ['P']],
      ['Headings', 2, ['H1']],
    ]);
    expect(matchCount).toBe(9);
  });

  it('hides the groups a page scope does not apply', () => {
    expect(match({ scope: 'page-left' }).toc.map((g) => g.key)).toEqual([
      'g:page',
    ]);
  });

  it('matches every query token against name, key and labels', () => {
    const query = (q: string) =>
      keys({ filter: { query: q, modifiedOnly: false } });
    expect(query('COLOR fore')).toEqual([
      'g:_meta-properties',
      's:_meta-properties/category:color',
      '--vs-color-foreground',
    ]);
    expect(query('body indent')).toEqual([
      'g:body',
      's:_basic/target:p',
      '--vs--p-text-indent',
    ]);
    expect(query('--vs-page--size')).toEqual([
      'g:page',
      's:page/category:page-setup',
      '--vs-page--size',
    ]);
  });

  it('matches a category label only where it heads a subgroup', () => {
    expect(keys({ filter: { query: 'padding', modifiedOnly: false } })).toEqual(
      [
        'g:page',
        's:page/category:margin',
        '--vs-page--margin-top',
        '--vs-page--margin-bottom',
      ],
    );
  });

  it('drops the sections left without matches', () => {
    const { toc } = match({ filter: { query: 'h1', modifiedOnly: false } });
    expect(toc).toMatchObject([
      {
        key: 'g:heading',
        count: 2,
        subgroups: [{ key: 's:_basic/target:h1' }],
      },
    ]);
  });

  it('filters and counts modified variables', () => {
    const modified = new Set(['--vs--h1-margin-block', '--vs-page--size']);
    const isModified = (name: string) => modified.has(name);
    const { toc, matchCount } = match({
      filter: { query: '', modifiedOnly: true },
      isModified,
    });
    expect(matchCount).toBe(2);
    expect(toc).toMatchObject([
      {
        key: 'g:page',
        count: 1,
        modified: 1,
        subgroups: [
          { key: 's:page/category:page-setup', count: 1, modified: 1 },
        ],
      },
      {
        key: 'g:heading',
        count: 1,
        modified: 1,
        subgroups: [{ key: 's:_basic/target:h1', count: 1, modified: 1 }],
      },
    ]);
  });

  it('reports modified counts without the filter', () => {
    const { toc } = match({
      isModified: (n) => n === '--vs--h1-margin-block',
    });
    expect(toc.at(-1)).toMatchObject({
      count: 2,
      modified: 1,
      subgroups: [{ count: 2, modified: 1 }],
    });
  });

  describe('with a group gathered from several tree groups', () => {
    const merged = buildThemeVariableSchema({
      _basic: {
        'h1-font-size': v('font-size'),
        'h1-margin-block': v('margin-block'),
      },
      section: {
        'h1-break-before': v('break-before'),
        'h1-break-after': v('break-after'),
      },
    });
    const isModified = (name: string) =>
      name === '--vs-section--h1-break-after';

    it('names the module of a subgroup lent to a group of another name', () => {
      expect(
        match({ groups: merged.groups }).toc.map((g) => [
          g.key,
          g.subgroups.map((s) => [s.key, s.label]),
        ]),
      ).toEqual([
        [
          'g:heading',
          [
            ['s:_basic/target:h1', 'H1'],
            ['s:section/target:h1', 'Sections: H1'],
          ],
        ],
      ]);
    });

    it('lists only the rows of the tree group picked', () => {
      expect(
        buildSettingsRows(
          match({ groups: merged.groups }),
          subgroupKey('section', target('h1')),
          100,
        ).map((row) => row.key),
      ).toEqual([
        'g:heading',
        's:section/target:h1',
        '--vs-section--h1-break-before',
        '--vs-section--h1-break-after',
      ]);
    });

    it('counts the modified variables across its tree groups', () => {
      expect(match({ groups: merged.groups, isModified }).toc).toMatchObject([
        {
          count: 4,
          modified: 1,
          subgroups: [
            { key: 's:_basic/target:h1', count: 2, modified: 0 },
            { key: 's:section/target:h1', count: 2, modified: 1 },
          ],
        },
      ]);
      expect(
        match({
          groups: merged.groups,
          isModified,
          filter: { query: '', modifiedOnly: true },
        }).toc,
      ).toMatchObject([
        {
          count: 1,
          subgroups: [{ key: 's:section/target:h1', count: 1, modified: 1 }],
        },
      ]);
    });
  });

  it('finds a group or a subgroup by its key', () => {
    const { toc } = match();
    expect(findSection(toc, groupKey('page'))?.label).toBe('Page');
    expect(findSection(toc, subgroupKey('page', category('margin')))).toEqual(
      expect.objectContaining({ label: 'Margin and padding', count: 2 }),
    );
    expect(findSection(toc, subgroupKey('_basic', target('h1')))?.label).toBe(
      'H1',
    );
    expect(
      findSection(toc, subgroupKey('page', target('margin'))),
    ).toBeUndefined();
  });
});

describe('buildSettingsRows', () => {
  it('lists every match without a section', () => {
    expect(keys({})).toEqual([
      'g:_meta-properties',
      's:_meta-properties/category:font',
      '--vs-font-family',
      's:_meta-properties/category:color',
      '--vs-color-foreground',
      '--vs-color-background',
      'g:page',
      's:page/category:page-setup',
      '--vs-page--size',
      's:page/category:margin',
      '--vs-page--margin-top',
      '--vs-page--margin-bottom',
      'g:body',
      's:_basic/target:p',
      '--vs--p-text-indent',
      'g:heading',
      's:_basic/target:h1',
      's:_basic/target:h1/font',
      '--vs--h1-font-size',
      's:_basic/target:h1/margin',
      '--vs--h1-margin-block',
    ]);
  });

  it('heads the categories of a target that spans several', () => {
    const rows = buildSettingsRows(
      match(),
      subgroupKey('_basic', target('h1')),
      100,
    );
    expect(
      rows.map((row) =>
        row.kind === 'variable' || row.kind === 'more'
          ? row.key
          : `${row.kind}: ${row.label}`,
      ),
    ).toEqual([
      'group: Headings',
      'subgroup: H1',
      'category: Font',
      '--vs--h1-font-size',
      'category: Margin and padding',
      '--vs--h1-margin-block',
    ]);
    const filtered = buildSettingsRows(
      match({ filter: { query: 'margin', modifiedOnly: false } }),
      subgroupKey('_basic', target('h1')),
      100,
    );
    expect(filtered.map((row) => row.kind)).toEqual([
      'group',
      'subgroup',
      'variable',
    ]);
  });

  it('lists a whole group', () => {
    expect(keys({}, groupKey('page'))).toEqual([
      'g:page',
      's:page/category:page-setup',
      '--vs-page--size',
      's:page/category:margin',
      '--vs-page--margin-top',
      '--vs-page--margin-bottom',
    ]);
  });

  it('lists only the subgroup under its group header', () => {
    expect(keys({}, subgroupKey('page', category('margin')))).toEqual([
      'g:page',
      's:page/category:margin',
      '--vs-page--margin-top',
      '--vs-page--margin-bottom',
    ]);
  });

  it('caps the variable rows and reports the rest', () => {
    const rows = buildSettingsRows(match(), null, 2);
    expect(rows.map((r) => r.key)).toEqual([
      'g:_meta-properties',
      's:_meta-properties/category:font',
      '--vs-font-family',
      's:_meta-properties/category:color',
      '--vs-color-foreground',
      'more',
    ]);
    expect(rows.at(-1)).toEqual({ kind: 'more', key: 'more', remaining: 7 });
  });

  it('does not leave a header without its variables at the cap', () => {
    expect(keys({}, groupKey('page'), 1)).toEqual([
      'g:page',
      's:page/category:page-setup',
      '--vs-page--size',
      'more',
    ]);
    expect(keys({}, subgroupKey('_basic', target('h1')), 1)).toEqual([
      'g:heading',
      's:_basic/target:h1',
      's:_basic/target:h1/font',
      '--vs--h1-font-size',
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
      getCategoryLabel: (id) => id,
      qualifyLabel: (module, label) => `${module}: ${label}`,
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
