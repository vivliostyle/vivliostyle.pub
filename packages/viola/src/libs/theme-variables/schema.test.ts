import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseThemeCss } from './css-model';
import {
  buildThemeVariableSchema,
  flattenThemeVariables,
  getThemeVariableName,
  loadThemeVariableSchema,
  type ThemeVariableSchema,
} from './schema';

const require = createRequire(import.meta.url);

const themeCssDir = join(
  dirname(require.resolve('@vivliostyle/theme-base/package.json')),
  'css',
);

const squash = (value: string | undefined) => value?.replace(/\s+/g, '');

describe('getThemeVariableName', () => {
  it.each([
    [['_meta-properties', 'font-family'], '--vs-font-family'],
    [['_basic', 'h1-font-size'], '--vs--h1-font-size'],
    [['page', 'margin-inside'], '--vs-page--margin-inside'],
    [['toc', 'marker-content'], '--vs-toc--marker-content'],
  ])('maps %j to %s', (path, name) => {
    expect(getThemeVariableName(path)).toBe(name);
  });
});

describe('flattenThemeVariables', () => {
  const tree = {
    '_meta-properties': {
      'color-foreground': {
        _syntax: '*',
        _property: 'color',
        _define: '#000',
      },
      'color-background': { _syntax: '*', _property: 'background-color' },
      'tab-size': { _syntax: '<integer> | <length>', _define: '4' },
    },
    page: {
      'mbox-top-left-content': { _syntax: '*', _property: 'content' },
      'mbox-top-left-font-size': { _syntax: '<length>' },
      'mbox-top-content': { _syntax: '*' },
      'mbox-top-font-size': { _syntax: '<length>' },
      'mbox-font-size': { _syntax: '<length>' },
      'mbox-inside-top-content': { _syntax: '*' },
      'border-color': {
        _syntax: '<color>',
        _property: ['border-top-color', 'border-bottom-color'],
      },
    },
    toc: {
      'anchor-text-decoration': {
        _syntax: '*',
        _define: [
          { media: '(hover: hover)', selector: 'a:hover', value: 'underline' },
        ],
      },
      label: {
        _syntax: '*',
        _define: [
          { value: "'Contents'" },
          { selector: ':root:lang(ja)', value: "'目次'" },
          { media: 'print', value: "''" },
        ],
      },
    },
    'not-a-group': 'ignored',
  };
  const variables = flattenThemeVariables(tree);
  const find = (name: string) => variables.find((v) => v.name === name);

  it('flattens leaves in tree order', () => {
    expect(variables.map((v) => v.name)).toEqual([
      '--vs-color-foreground',
      '--vs-color-background',
      '--vs-tab-size',
      '--vs-page--mbox-top-left-content',
      '--vs-page--mbox-top-left-font-size',
      '--vs-page--mbox-top-content',
      '--vs-page--mbox-top-font-size',
      '--vs-page--mbox-font-size',
      '--vs-page--mbox-inside-top-content',
      '--vs-page--border-color',
      '--vs-toc--anchor-text-decoration',
      '--vs-toc--label',
    ]);
  });

  it('carries the metadata of a variable', () => {
    expect(find('--vs-color-foreground')).toEqual({
      name: '--vs-color-foreground',
      path: ['_meta-properties', 'color-foreground'],
      group: '_meta-properties',
      subgroup: 'color',
      key: 'color-foreground',
      syntax: '*',
      properties: ['color'],
      defaultValue: '#000',
      conditionalDefaults: [],
    });
    expect(find('--vs-page--border-color')?.properties).toEqual([
      'border-top-color',
      'border-bottom-color',
    ]);
    expect(find('--vs-tab-size')?.properties).toEqual([]);
  });

  it('separates the `:root` default from conditional ones', () => {
    expect(find('--vs-toc--label')).toMatchObject({
      defaultValue: "'Contents'",
      conditionalDefaults: [
        { selector: ':root:lang(ja)', value: "'目次'" },
        { media: 'print', value: "''" },
      ],
    });
    expect(find('--vs-toc--anchor-text-decoration')).toMatchObject({
      defaultValue: undefined,
      conditionalDefaults: [
        { media: '(hover: hover)', selector: 'a:hover', value: 'underline' },
      ],
    });
  });

  it('clusters variables sharing a prefix and leaves the rest alone', () => {
    expect(
      Object.fromEntries(variables.map((v) => [v.name, v.subgroup])),
    ).toEqual({
      '--vs-color-foreground': 'color',
      '--vs-color-background': 'color',
      '--vs-tab-size': null,
      '--vs-page--mbox-top-left-content': 'mbox-top-left',
      '--vs-page--mbox-top-left-font-size': 'mbox-top-left',
      '--vs-page--mbox-top-content': 'mbox-top',
      '--vs-page--mbox-top-font-size': 'mbox-top',
      '--vs-page--mbox-font-size': 'mbox',
      '--vs-page--mbox-inside-top-content': 'mbox',
      '--vs-page--border-color': null,
      '--vs-toc--anchor-text-decoration': null,
      '--vs-toc--label': null,
    });
  });

  it('builds a grouped tree with the leading groups first', () => {
    const schema = buildThemeVariableSchema({
      toc: tree.toc,
      _basic: { 'p-font-size': { _syntax: '<length>' } },
      page: tree.page,
      '_meta-properties': tree['_meta-properties'],
      appendix: { label: { _syntax: '*' } },
    });
    expect(schema.groups.map((g) => g.id)).toEqual([
      '_meta-properties',
      'page',
      '_basic',
      'toc',
      'appendix',
    ]);
    const page = schema.groups[1];
    expect(page.variables).toHaveLength(7);
    expect(page.ungrouped.map((v) => v.key)).toEqual(['border-color']);
    expect(page.subgroups.map((s) => [s.id, s.variables.length])).toEqual([
      ['mbox-top-left', 2],
      ['mbox-top', 2],
      ['mbox', 2],
    ]);
    expect(schema.byName.get('--vs--p-font-size')?.group).toBe('_basic');
  });

  it('tolerates malformed input', () => {
    expect(flattenThemeVariables(null)).toEqual([]);
    expect(flattenThemeVariables([{ _syntax: '*' }])).toEqual([]);
    expect(flattenThemeVariables({ a: { b: { _syntax: 1 } } })).toEqual([]);
  });
});

describe('loadThemeVariableSchema', () => {
  let schema: ThemeVariableSchema;

  beforeAll(async () => {
    schema = await loadThemeVariableSchema();
  });

  it('caches the schema', () => {
    expect(loadThemeVariableSchema()).toBe(loadThemeVariableSchema());
  });

  it('lists uniquely named variables in every group', () => {
    expect(schema.variables.length).toBeGreaterThan(1000);
    expect(schema.byName.size).toBe(schema.variables.length);
    expect(schema.groups.slice(0, 3).map((g) => g.id)).toEqual([
      '_meta-properties',
      'page',
      '_basic',
    ]);
    for (const variable of schema.variables) {
      expect(variable.name).toMatch(/^--vs-[a-z0-9-]+$/);
      expect(variable.path).toHaveLength(2);
      expect(variable.syntax).not.toBe('');
    }
    for (const group of schema.groups) {
      const grouped = group.subgroups.flatMap((s) => s.variables);
      expect(grouped.length + group.ungrouped.length).toBe(
        group.variables.length,
      );
    }
  });

  it('names variables as the stylesheets of the theme use them', () => {
    const used = new Set(
      readdirSync(themeCssDir, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.css'))
        .flatMap(
          (file) =>
            readFileSync(join(themeCssDir, file), 'utf8').match(
              // Comments mention families of variables like `--vs--pre-*`.
              /--vs-[\w-]*\w(?![\w-])/g,
            ) ?? [],
        ),
    );
    expect([...used].sort()).toEqual([...schema.byName.keys()].sort());
  });

  it('agrees with the defaults that `define.css` declares', () => {
    const model = parseThemeCss(
      readFileSync(join(themeCssDir, 'define.css'), 'utf8'),
    );
    expect(model.diagnostics).toEqual([]);
    const { root, 'print-root': print, 'screen-root': screen } = model.scopes;

    const declared = schema.variables.filter((v) => v.defaultValue);
    expect(Object.keys(root.variables).sort()).toEqual(
      declared.map((v) => v.name).sort(),
    );
    for (const variable of declared) {
      expect(squash(root.variables[variable.name].value), variable.name).toBe(
        squash(variable.defaultValue),
      );
    }

    for (const [media, scope] of [
      ['print', print],
      ['screen', screen],
    ] as const) {
      const conditional = schema.variables.flatMap((v) =>
        v.conditionalDefaults
          .filter((d) => d.media === media && !d.selector)
          .map((d) => [v.name, squash(d.value)]),
      );
      expect(conditional.length).toBeGreaterThan(0);
      expect(
        Object.values(scope.variables)
          .map((v) => [v.name, squash(v.value)])
          .sort(),
      ).toEqual(conditional.sort());
    }
  });
});
