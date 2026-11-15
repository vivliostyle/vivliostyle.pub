import { describe, expect, it } from 'vitest';

import {
  languageRange,
  replaceLanguage,
  suggestLanguages,
} from './code-block-language';

const languages = ['java', 'javascript', 'js', 'json', 'python'];

describe('languageRange', () => {
  it.each([
    ['', 0, 0],
    ['js', 0, 2],
    ['js title=a.js', 0, 2],
    [' \tjs  title=a.js', 2, 4],
    ['js:a.js title=x', 0, 2],
    ['   ', 3, 3],
    [' title=x', 1, 8],
  ])('finds the language in %j', (infoString, from, to) => {
    expect(languageRange(infoString)).toEqual({ from, to });
  });
});

describe('replaceLanguage', () => {
  it('keeps everything around the language as written', () => {
    expect(replaceLanguage('  js   title="a b" ', 'python')).toEqual({
      infoString: '  python   title="a b" ',
      caret: 8,
    });
    expect(replaceLanguage('js:a.js {.c}', 'ts')).toEqual({
      infoString: 'ts:a.js {.c}',
      caret: 2,
    });
    expect(replaceLanguage('', 'js')).toEqual({ infoString: 'js', caret: 2 });
  });
});

describe('suggestLanguages', () => {
  it('matches what is typed before the caret', () => {
    expect(suggestLanguages(languages, 'ja title=x', 2)).toEqual([
      'java',
      'javascript',
    ]);
    expect(suggestLanguages(languages, 'JS title=x', 1)).toEqual([
      'java',
      'javascript',
      'js',
      'json',
    ]);
  });

  it('suggests nothing once the caret leaves the language', () => {
    expect(suggestLanguages(languages, 'ja title=x', 3)).toEqual([]);
    expect(suggestLanguages(languages, 'js:ja', 4)).toEqual([]);
  });

  it('lists every language for an empty language only when browsing', () => {
    expect(suggestLanguages(languages, ' title=x', 0)).toEqual([]);
    expect(suggestLanguages(languages, '', 0, { browse: true })).toEqual(
      languages,
    );
  });

  it('suggests nothing when the language is the only match', () => {
    expect(suggestLanguages(languages, 'python', 3)).toEqual([]);
    expect(suggestLanguages(languages, 'js', 2)).toEqual(['js', 'json']);
  });
});
