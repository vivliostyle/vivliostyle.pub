import type { CaseSuite } from '../testing/vitest';

const PLAIN_TEXT = 'kept as plain text';

export const vfmSuites: CaseSuite[] = [
  {
    title: 'VFM ruby',
    cases: [
      { name: 'ruby', given: '{漢字|かんじ}を読む' },
      {
        name: 'ruby is a node',
        given: '{漢字|かんじ}を読む',
        doc: 'doc(paragraph(ruby("漢字"), "を読む"))',
        fails: PLAIN_TEXT,
      },
      {
        name: 'escaped pipe in the base text',
        given: 'a {a\\|b|c} b',
        fails: 'the backslash is dropped',
      },
      {
        name: 'escaped brace is not ruby',
        given: '\\{a|b}',
        fails: 'the backslash is dropped',
      },
    ],
  },
  {
    title: 'VFM math',
    cases: [
      { name: 'inline math', given: '$x^2$ と' },
      { name: 'display math', given: '$$\ny=1\n$$' },
      {
        name: 'inline math is a node',
        given: '$x^2$ と',
        doc: 'doc(paragraph(math, " と"))',
        fails: PLAIN_TEXT,
      },
    ],
  },
  {
    title: 'VFM attributes',
    cases: [
      { name: 'heading attributes', given: '# 見出し {#id .cls}' },
      {
        name: 'heading attributes are attributes',
        given: '# 見出し {#id .cls}',
        doc: 'doc(heading("見出し"))',
        fails: PLAIN_TEXT,
      },
      {
        name: 'image attributes',
        given: '![cap](a.png){width=100}',
        fails:
          'the block image and the text end up in one paragraph, an invalid document',
      },
      { name: 'inline attributes', given: '**s**{.x}' },
    ],
  },
  {
    title: 'VFM footnotes',
    cases: [
      { name: 'inline footnote', given: 'inline^[脚注] text' },
      {
        name: 'footnote reference and definition',
        given: '脚注[^1]です。\n\n[^1]: 本文',
        fails: 'the reference becomes a link and the definition is dropped',
      },
    ],
  },
  {
    title: 'VFM blocks',
    cases: [
      { name: 'code with a caption', given: '```js:app.js\nconst a = 1;\n```' },
      {
        name: 'code with a title',
        given: '```js title="my app.js"\nconst a = 1;\n```',
      },
      { name: 'table of contents', given: '[[toc]]' },
      {
        name: 'heading that opens no section',
        given: '## D ##',
        fails: 'the closing sequence is dropped',
      },
      {
        name: 'line that closes a section',
        given: '# A\n\ntext\n\n#\n\nafter',
        fails: 'read as an empty heading and written without its "#"',
      },
    ],
  },
];
