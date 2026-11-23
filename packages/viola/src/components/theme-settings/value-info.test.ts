import tree from '@vivliostyle/theme-base/css-variables.json';
import { describe, expect, it } from 'vitest';

import { flattenThemeVariables, parseSyntax } from '../../libs/theme-variables';
import { getCssReference, getDataTypeUrl, getValueUnits } from './value-info';

const MDN = 'https://developer.mozilla.org/docs/Web/CSS/Reference';

// Properties (and the `@page` descriptor `size`) fed by theme-base whose MDN
// page has been confirmed. A newer theme-base that feeds another one fails the
// last `getCssReference` test until its page is confirmed or it is marked
// undocumented.
const CONFIRMED_ON_MDN = new Set(
  `
  align-items background background-color background-image background-position
  background-size border-block-end-color border-block-end-style
  border-block-end-width border-block-start-color border-block-start-style
  border-block-start-width border-bottom-color border-bottom-style
  border-bottom-width border-collapse border-color border-inline-end-color
  border-inline-end-style border-inline-end-width border-inline-start-color
  border-inline-start-style border-inline-start-width border-left-color
  border-left-style border-left-width border-radius border-right-color
  border-right-style border-right-width border-top-color border-top-style
  border-top-width break-after break-before break-inside clear color
  column-fill column-gap column-rule-color column-rule-style column-rule-width
  columns content counter-increment counter-reset display flex-direction float
  font-family font-feature-settings font-kerning font-size font-stretch
  font-style font-synthesis font-variant font-variant-ligatures
  font-variant-numeric font-variation-settings font-weight gap
  hanging-punctuation height hyphens image-resolution inline-size
  inset-block-end inset-block-start inset-inline-start letter-spacing
  line-break line-height list-style-position list-style-type margin-block
  margin-bottom margin-inline margin-inline-end margin-inline-start
  margin-left margin-right margin-top max-block-size max-inline-size
  min-block-size order orphans overflow-wrap overflow-x padding padding-block
  padding-bottom padding-inline padding-inline-end padding-inline-start
  padding-left padding-right padding-top position ruby-align ruby-position
  size tab-size table-layout text-align text-combine-upright text-decoration
  text-indent text-orientation text-shadow text-transform
  text-underline-offset text-underline-position vertical-align visibility
  white-space widows width word-break word-spacing writing-mode
  `
    .trim()
    .split(/\s+/),
);

describe('getCssReference', () => {
  it('links a property to its MDN page', () => {
    expect(getCssReference('margin-top')).toEqual({
      name: 'margin-top',
      atRule: null,
      url: `${MDN}/Properties/margin-top`,
    });
  });

  it('links an @page descriptor under @page', () => {
    expect(getCssReference('size')).toEqual({
      name: 'size',
      atRule: '@page',
      url: `${MDN}/At-rules/@page/size`,
    });
  });

  it('keeps the at-rule of an undocumented descriptor', () => {
    expect(getCssReference('bleed')).toEqual({
      name: 'bleed',
      atRule: '@page',
      url: null,
    });
    expect(getCssReference('marks').url).toBeNull();
  });

  it.each([
    'string-set',
    'text-spacing',
    '-webkit-text-stroke',
    '--vs-color-body',
    'Color',
    '',
  ])('leaves %j unlinked', (name) => {
    expect(getCssReference(name).url).toBeNull();
  });

  it('links only pages confirmed on MDN for theme-base', () => {
    const names = new Set(
      flattenThemeVariables(tree).flatMap((variable) => variable.properties),
    );
    const unconfirmed = [...names].filter(
      (name) =>
        getCssReference(name).url !== null && !CONFIRMED_ON_MDN.has(name),
    );
    expect(unconfirmed).toEqual([]);
  });
});

describe('getDataTypeUrl', () => {
  it.each([
    ['length', `${MDN}/Values/length`],
    ['length-percentage', `${MDN}/Values/length-percentage`],
    ['custom-ident', `${MDN}/Values/custom-ident`],
    ['color', `${MDN}/Values/color_value`],
  ] as const)('%s → %s', (type, url) => {
    expect(getDataTypeUrl(type)).toBe(url);
  });

  it('has no page for font-family names', () => {
    expect(getDataTypeUrl('font-family')).toBeNull();
  });
});

describe('getValueUnits', () => {
  it('lists the units of the dimension types', () => {
    const units = getValueUnits(parseSyntax('auto | <length-percentage>'));
    expect(units).toContain('mm');
    expect(units).toContain('%');
    expect(units).not.toContain('');
  });

  it('is empty for numbers and keywords', () => {
    expect(getValueUnits(parseSyntax('bold | normal | <number>'))).toEqual([]);
    expect(getValueUnits(parseSyntax('inside | outside'))).toEqual([]);
  });
});
