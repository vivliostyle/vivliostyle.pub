import refractor from 'refractor';
import { describe, expect, it } from 'vitest';

import { flattenRefractorNodes, resolveVfmLanguage } from './code-block-prism';

describe('resolveVfmLanguage', () => {
  it('returns the language as-is', () => {
    expect(resolveVfmLanguage('js')).toBe('js');
  });

  it('returns null when no language is given', () => {
    expect(resolveVfmLanguage(null)).toBeNull();
    expect(resolveVfmLanguage(undefined)).toBeNull();
    expect(resolveVfmLanguage('')).toBeNull();
  });

  it('strips the VFM `lang:title` suffix', () => {
    expect(resolveVfmLanguage('js:example.js')).toBe('js');
  });

  it('uses only the first word of the info string', () => {
    expect(resolveVfmLanguage('js title="example"')).toBe('js');
    expect(resolveVfmLanguage('js:example.js {.numberLines}')).toBe('js');
  });

  it('keeps a trailing colon without title, matching VFM', () => {
    expect(resolveVfmLanguage('js:')).toBe('js:');
  });
});

describe('flattenRefractorNodes', () => {
  it('produces spans matching refractor token classes', () => {
    const source = 'const answer = 42;';
    const spans = flattenRefractorNodes(refractor.highlight(source, 'js'));

    expect(spans.map((span) => span.text).join('')).toBe(source);
    expect(spans).toContainEqual({
      text: 'const',
      classes: ['token', 'keyword'],
    });
    expect(spans).toContainEqual({
      text: '42',
      classes: ['token', 'number'],
    });
  });

  it('merges ancestor classes of nested tokens', () => {
    const spans = flattenRefractorNodes(
      refractor.highlight(`\`a\${b}\``, 'js'),
    );
    const interpolation = spans.find((span) => span.text === 'b');

    expect(interpolation?.classes).toEqual([
      'token',
      'template-string',
      'interpolation',
    ]);
  });
});
