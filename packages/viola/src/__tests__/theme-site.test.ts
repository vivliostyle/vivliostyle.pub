import { describe, expect, it } from 'vitest';

import {
  extractTemplateFiles,
  isThemePackageSpecifier,
  parsePickerMessage,
  pickerUrl,
} from '../libs/theme-site';

describe('pickerUrl', () => {
  it('opens the selection mode in the UI language', () => {
    expect(pickerUrl('ja')).toBe(
      'https://theme.vivliostyle.org/ja/select?client=pub&v=1',
    );
    expect(pickerUrl('de')).toBe(
      'https://theme.vivliostyle.org/en/select?client=pub&v=1',
    );
  });
});

describe('parsePickerMessage', () => {
  it('accepts the messages of protocol 1', () => {
    expect(
      parsePickerMessage({
        type: 'vivliostyle-theme-picker:ready',
        protocol: 1,
      }),
    ).toEqual({ type: 'vivliostyle-theme-picker:ready', protocol: 1 });
    expect(
      parsePickerMessage({
        type: 'vivliostyle-theme-picker:select',
        protocol: 1,
        theme: { name: '@vivliostyle/theme-academic', version: '3.0.0' },
        template: { id: 'paper' },
        extra: 'ignored',
      }),
    ).toEqual({
      type: 'vivliostyle-theme-picker:select',
      protocol: 1,
      theme: { name: '@vivliostyle/theme-academic', version: '3.0.0' },
      template: { id: 'paper' },
    });
  });

  it.each([
    null,
    'vivliostyle-theme-picker:ready',
    { type: 'vivliostyle-theme-picker:ready', protocol: 2 },
    { type: 'other', protocol: 1 },
    {
      type: 'vivliostyle-theme-picker:select',
      protocol: 1,
      theme: { name: 'Bad Name', version: '1.0.0' },
    },
    {
      type: 'vivliostyle-theme-picker:select',
      protocol: 1,
      theme: { name: 'theme', version: '^1.0.0' },
    },
    {
      type: 'vivliostyle-theme-picker:select',
      protocol: 1,
      theme: { name: 'theme', version: '1.0.0' },
      template: { id: '' },
    },
  ])('rejects %j', (data) => {
    expect(parsePickerMessage(data)).toBeUndefined();
  });
});

describe('extractTemplateFiles', () => {
  const encoder = new TextEncoder();
  const files = new Map([
    ['node_modules/@scope/theme/package.json', encoder.encode('{}')],
    [
      'node_modules/@scope/theme/template/paper/manuscript.md',
      encoder.encode('# {{title}}'),
    ],
    [
      'node_modules/@scope/theme/template/paper/assets/a.png',
      encoder.encode('png'),
    ],
    ['node_modules/@vivliostyle/theme-base/theme.css', encoder.encode('')],
  ]);

  it('picks the files of a template inside the package', () => {
    expect(
      Object.keys(
        extractTemplateFiles(files, '@scope/theme', './template/paper/') ?? {},
      ),
    ).toEqual(['manuscript.md', 'assets/a.png']);
  });

  it('leaves other sources to the CLI', () => {
    expect(
      extractTemplateFiles(files, '@scope/theme', 'gh:org/repo/template'),
    ).toBeUndefined();
  });

  it('rejects templates outside of the package or missing', () => {
    expect(() =>
      extractTemplateFiles(files, '@scope/theme', '../../theme-base'),
    ).toThrow('outside');
    expect(() =>
      extractTemplateFiles(files, '@scope/theme', './template/none'),
    ).toThrow('not found');
  });
});

describe('isThemePackageSpecifier', () => {
  it.each([
    ['@vivliostyle/theme-academic', true],
    ['my-theme@^1.0.0', true],
    ['./style.css', false],
    ['/abs/theme.css', false],
    ['https://example.com/theme.css', false],
    ['themes/custom.css', false],
    [42, false],
  ])('%j → %s', (value, expected) => {
    expect(isThemePackageSpecifier(value)).toBe(expected);
  });
});
