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
      subgroup: { kind: 'category', id: 'color' },
      key: 'color-foreground',
      target: null,
      propertyKey: 'color-foreground',
      category: 'color',
      advanced: false,
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

  describe('sorting a variable into a subgroup', () => {
    const subgroups = (tree: Record<string, Record<string, object>>) =>
      Object.fromEntries(
        flattenThemeVariables(tree).map((v) => [
          v.name,
          `${v.subgroup.kind}:${v.subgroup.id}`,
        ]),
      );

    it('gives a target of two or more variables its own subgroup', () => {
      expect(
        subgroups({
          _basic: {
            'table-border-color': { _syntax: '*', _property: 'border-color' },
            'table-width': { _syntax: '*', _property: 'width' },
            'table-cell-padding': { _syntax: '*', _property: 'padding' },
            'table-cell-text-align': { _syntax: '*', _property: 'text-align' },
          },
        }),
      ).toEqual({
        '--vs--table-border-color': 'target:table',
        '--vs--table-width': 'target:table',
        '--vs--table-cell-padding': 'target:table-cell',
        '--vs--table-cell-text-align': 'target:table-cell',
      });
    });

    it('moves a lone target into the nearest subgroup it is part of', () => {
      expect(
        subgroups({
          _basic: {
            'table-border-color': { _syntax: '*', _property: 'border-color' },
            'table-width': { _syntax: '*', _property: 'width' },
            'table-row-height': { _syntax: '*', _property: 'height' },
            'table-row-even-background-color': {
              _syntax: '*',
              _property: 'background-color',
            },
          },
        }),
      ).toEqual({
        '--vs--table-border-color': 'target:table',
        '--vs--table-width': 'target:table',
        '--vs--table-row-height': 'target:table',
        '--vs--table-row-even-background-color': 'target:table',
      });
    });

    it('moves another lone target into its category of the group', () => {
      expect(
        subgroups({
          prism: {
            'text-color': { _syntax: '*', _property: 'color' },
            'keyword-text-color': { _syntax: '*', _property: 'color' },
            'comment-text-color': { _syntax: '*', _property: 'color' },
          },
        }),
      ).toEqual({
        '--vs-prism--text-color': 'category:color',
        '--vs-prism--keyword-text-color': 'category:color',
        '--vs-prism--comment-text-color': 'category:color',
      });
    });

    it('keeps a lone target with nowhere to go in a subgroup', () => {
      expect(
        subgroups({
          _basic: {
            'del-text-decoration': {
              _syntax: '*',
              _property: 'text-decoration',
            },
            'p-font-size': { _syntax: '*', _property: 'font-size' },
            'p-text-indent': { _syntax: '*', _property: 'text-indent' },
          },
        }),
      ).toEqual({
        '--vs--del-text-decoration': 'target:del',
        '--vs--p-font-size': 'target:p',
        '--vs--p-text-indent': 'target:p',
      });
    });

    it('sorts a variable without a target by its category', () => {
      expect(
        subgroups({
          '_meta-properties': {
            'line-height': { _syntax: '*', _property: 'line-height' },
            'line-break': { _syntax: '*', _property: 'line-break' },
          },
        }),
      ).toEqual({
        '--vs-line-height': 'category:spacing',
        '--vs-line-break': 'category:line-breaking',
      });
    });
  });

  it('categorizes a variable by the property it feeds', () => {
    expect(
      Object.fromEntries(
        flattenThemeVariables({
          '_meta-properties': {
            'color-border': { _syntax: '*', _property: 'border-color' },
            'font-family-alt': { _syntax: '*' },
            'widows-orphans': { _syntax: '*' },
            'spacing-rlh': { _syntax: '*' },
          },
          _basic: {
            'h1-size-inline': { _syntax: '*', _property: 'inline-size' },
            'h1-text-color': { _syntax: '*', _property: 'color' },
          },
          page: {
            'mbox-top-font-size': { _syntax: '*', _property: 'font-size' },
            'mbox-top-inside-content': { _syntax: '*' },
            'cover-page-mbox-visibility': { _syntax: '*' },
            mystery: { _syntax: '*' },
          },
        }).map((v) => [v.name, v.category]),
      ),
    ).toEqual({
      '--vs-color-border': 'color',
      '--vs-font-family-alt': 'font',
      '--vs-widows-orphans': 'fragmentation',
      '--vs-spacing-rlh': 'margin',
      '--vs--h1-size-inline': 'layout',
      '--vs--h1-text-color': 'color',
      '--vs-page--mbox-top-font-size': 'font',
      '--vs-page--mbox-top-inside-content': 'generated-content',
      '--vs-page--cover-page-mbox-visibility': 'visibility',
      '--vs-page--mystery': 'other',
    });
  });

  it('marks the counter internals as advanced', () => {
    expect(
      Object.fromEntries(
        flattenThemeVariables({
          figure: {
            'counter-style': { _syntax: '*' },
            label: { _syntax: '*' },
            'root-counter-reset': { _syntax: '*', _property: 'counter-reset' },
            'root-counter-fig': { _syntax: '*' },
          },
          '_meta-properties': {
            'crossref-call-counter-prefix': { _syntax: '*' },
          },
        }).map((v) => [v.name, v.advanced]),
      ),
    ).toEqual({
      '--vs-figure--counter-style': false,
      '--vs-figure--label': false,
      '--vs-figure--root-counter-reset': true,
      '--vs-figure--root-counter-fig': true,
      '--vs-crossref-call-counter-prefix': true,
    });
  });

  describe('splitting a key into its target and property', () => {
    const split = (tree: Record<string, Record<string, object>>) =>
      Object.fromEntries(
        flattenThemeVariables(tree).map((v) => [
          v.name,
          [v.target, v.propertyKey],
        ]),
      );

    it('splits before the property the variable is used in', () => {
      expect(
        split({
          '_meta-properties': {
            'line-height': { _syntax: '*', _property: 'line-height' },
            'first-page-counter-reset': {
              _syntax: '*',
              _property: 'counter-reset',
            },
          },
          _basic: {
            'h1-font-size': { _syntax: '*', _property: 'font-size' },
            'blockquote-p-text-align': {
              _syntax: '*',
              _property: 'text-align',
            },
          },
        }),
      ).toEqual({
        '--vs-line-height': [null, 'line-height'],
        '--vs-first-page-counter-reset': ['first-page', 'counter-reset'],
        '--vs--h1-font-size': ['h1', 'font-size'],
        '--vs--blockquote-p-text-align': ['blockquote-p', 'text-align'],
      });
    });

    it('matches the aliased name of the property', () => {
      expect(
        split({
          _basic: {
            'h1-border-color-block-end': {
              _syntax: '*',
              _property: 'border-block-end-color',
            },
            'h1-text-color': { _syntax: '*', _property: 'color' },
            'figure-item-max-size-inline': {
              _syntax: '*',
              _property: 'max-inline-size',
            },
          },
        }),
      ).toEqual({
        '--vs--h1-border-color-block-end': ['h1', 'border-color-block-end'],
        '--vs--h1-text-color': ['h1', 'text-color'],
        '--vs--figure-item-max-size-inline': ['figure-item', 'max-size-inline'],
      });
    });

    it('prefers the longest property name', () => {
      expect(
        split({
          page: {
            'mbox-font-size': {
              _syntax: '*',
              _property: ['font-size', 'size'],
            },
          },
        }),
      ).toEqual({ '--vs-page--mbox-font-size': ['mbox', 'font-size'] });
    });

    it('gives a hand-named key the longest target known in its group', () => {
      expect(
        split({
          _basic: {
            'blockquote-font-size': { _syntax: '*', _property: 'font-size' },
            'blockquote-p-text-indent': {
              _syntax: '*',
              _property: 'text-indent',
            },
            'blockquote-p-border-color': {
              _syntax: '*',
              _property: ['border-block-end-color', 'border-block-start-color'],
            },
            'blockquote-border-width': { _syntax: '*' },
          },
          figure: {
            'root-counter-reset': { _syntax: '*', _property: 'counter-reset' },
            'root-counter-fig': { _syntax: '*' },
          },
          toc: { 'blockquote-label': { _syntax: '*' } },
        }),
      ).toEqual({
        '--vs--blockquote-font-size': ['blockquote', 'font-size'],
        '--vs--blockquote-p-text-indent': ['blockquote-p', 'text-indent'],
        '--vs--blockquote-p-border-color': ['blockquote-p', 'border-color'],
        '--vs--blockquote-border-width': ['blockquote', 'border-width'],
        '--vs-figure--root-counter-reset': ['root', 'counter-reset'],
        '--vs-figure--root-counter-fig': ['root', 'counter-fig'],
        '--vs-toc--blockquote-label': [null, 'blockquote-label'],
      });
    });

    it('leaves a key without a known target whole', () => {
      expect(
        split({
          '_meta-properties': {
            'color-foreground': { _syntax: '*', _property: 'color' },
            'spacing-rlh': { _syntax: '*' },
          },
          page: {
            'margin-inside': {
              _syntax: '*',
              _property: ['margin-left', 'margin-right'],
            },
          },
        }),
      ).toEqual({
        '--vs-color-foreground': [null, 'color-foreground'],
        '--vs-spacing-rlh': [null, 'spacing-rlh'],
        '--vs-page--margin-inside': [null, 'margin-inside'],
      });
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
    expect(
      page.subgroups.map((s) => [s.kind, s.id, s.variables.length]),
    ).toEqual([
      ['category', 'font', 2],
      ['category', 'border', 1],
      ['category', 'generated-content', 2],
      ['target', 'mbox-top-left', 2],
    ]);
    expect(page.subgroups.at(-1)?.variables.map((v) => v.key)).toEqual([
      'mbox-top-left-font-size',
      'mbox-top-left-content',
    ]);
    expect(schema.byName.get('--vs--p-font-size')?.group).toBe('_basic');
  });

  it('gathers the elements and modules of a subject', () => {
    const v = (property: string) => ({ _syntax: '*', _property: property });
    const schema = buildThemeVariableSchema({
      _basic: {
        'bold-emphasis-font-size': v('font-size'),
        'bold-emphasis-font-weight': v('font-weight'),
        'bold-font-size': v('font-size'),
        'bold-font-weight': v('font-weight'),
        'h1-font-size': v('font-size'),
        'h1-margin-block': v('margin-block'),
        'heading-font-size': v('font-size'),
        'heading-margin-block': v('margin-block'),
        'marquee-font-size': v('font-size'),
        'marquee-color': v('color'),
        'table-width': v('width'),
        'table-height': v('height'),
      },
      listing: { 'call-content': v('content'), 'call-display': v('display') },
      table: { 'call-content': v('content'), 'call-display': v('display') },
      widget: { 'foo-content': v('content'), 'foo-display': v('display') },
      heading: { 'foo-content': v('content'), 'foo-display': v('display') },
    });
    expect(
      schema.groups.map((group) => [
        group.id,
        group.subgroups.map(
          (s) => `${s.group}/${s.id}${s.module ? ` (${s.module})` : ''}`,
        ),
      ]),
    ).toEqual([
      ['heading', ['_basic/heading', '_basic/h1', 'heading/foo']],
      ['table', ['_basic/table', 'table/call']],
      ['code', ['listing/call (listing)']],
      ['inline', ['_basic/bold', '_basic/bold-emphasis']],
      ['_basic', ['_basic/marquee']],
      ['widget', ['widget/foo']],
    ]);
  });

  it('folds a module into the elements of its subject', () => {
    const v = (property?: string) => ({ _syntax: '*', _property: property });
    const schema = buildThemeVariableSchema({
      _basic: {
        'h1-font-size': v('font-size'),
        'h1-break-after': v('break-after'),
        'heading-font-size': v('font-size'),
        'heading-margin-block': v('margin-block'),
      },
      section: {
        'call-content': v('content'),
        'call-display': v('display'),
        'counter-style': v(),
        'h1-break-after': v('break-after'),
        'h1-break-before': v('break-before'),
        'h1-marker-content': v('content'),
        'h1-marker-display': v('display'),
        label: v(),
      },
    });
    expect(
      schema.groups.map((group) => [
        group.id,
        group.subgroups.map((s) => [
          `${s.group}/${s.id}`,
          s.module,
          s.variables.map((variable) => variable.name),
        ]),
      ]),
    ).toEqual([
      [
        'heading',
        [
          [
            '_basic/heading',
            null,
            [
              '--vs--heading-font-size',
              '--vs--heading-margin-block',
              '--vs-section--call-display',
              '--vs-section--call-content',
              '--vs-section--label',
              '--vs-section--counter-style',
            ],
          ],
          [
            '_basic/h1',
            null,
            [
              '--vs--h1-font-size',
              '--vs-section--h1-marker-display',
              '--vs-section--h1-break-before',
              '--vs--h1-break-after',
              '--vs-section--h1-break-after',
              '--vs-section--h1-marker-content',
            ],
          ],
        ],
      ],
    ]);
  });

  it('orders the variables of a subgroup by their properties', () => {
    const v = (property: string) => ({ _syntax: '*', _property: property });
    const schema = buildThemeVariableSchema({
      _basic: {
        'h1-border-color-block-end': v('border-block-end-color'),
        'h1-border-color-block-start': v('border-block-start-color'),
        'h1-border-width': v('border-width'),
        'h1-font-family': v('font-family'),
        'h1-font-size': v('font-size'),
      },
      page: {
        'margin-bottom': v('margin-bottom'),
        'margin-left': v('margin-left'),
        'margin-right': v('margin-right'),
        'margin-top': v('margin-top'),
      },
    });
    expect(
      schema.groups.map((group) =>
        group.subgroups.flatMap((s) => s.variables.map((x) => x.key)),
      ),
    ).toEqual([
      ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
      [
        'h1-font-family',
        'h1-font-size',
        'h1-border-width',
        'h1-border-color-block-start',
        'h1-border-color-block-end',
      ],
    ]);
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
    expect(schema.groups.map((g) => g.id)).toEqual([
      '_meta-properties',
      'page',
      'body',
      'heading',
      'list',
      'table',
      'figure',
      'code',
      'math',
      'inline',
      'appendix',
      'citation',
      'endnote',
      'footnote',
      'sidenote',
      'theorem',
      'toc',
    ]);
    for (const variable of schema.variables) {
      expect(variable.name).toMatch(/^--vs-[a-z0-9-]+$/);
      expect(variable.path).toHaveLength(2);
      expect(variable.syntax).not.toBe('');
    }
    for (const group of schema.groups) {
      expect(group.subgroups.flatMap((s) => s.variables)).toHaveLength(
        group.variables.length,
      );
    }
  });

  it('sorts the variables into subgroups of known categories', () => {
    const sections = Object.fromEntries(
      schema.groups.map((group) => [
        group.id,
        group.subgroups.map(
          (s) =>
            `${s.module ?? (s.group === group.id ? '' : s.group)}/${s.kind}:${s.id} (${s.variables.length})`,
        ),
      ]),
    );
    expect(sections).toMatchSnapshot();
    expect(
      schema.variables.filter((v) => v.category === 'other').map((v) => v.name),
    ).toEqual([]);
  });

  it('splits every key into its target and property', () => {
    for (const { key, target, propertyKey } of schema.variables) {
      expect(propertyKey, key).not.toBe('');
      expect(target === null ? propertyKey : `${target}-${propertyKey}`).toBe(
        key,
      );
    }
    // A theme-base update shows up here as targets gained, lost or resized.
    const targets: Record<string, Record<string, number>> = {};
    for (const { group, target } of schema.variables) {
      const counts = targets[group] ?? {};
      const id = target ?? '(none)';
      counts[id] = (counts[id] ?? 0) + 1;
      targets[group] = counts;
    }
    expect(targets).toMatchSnapshot();
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
