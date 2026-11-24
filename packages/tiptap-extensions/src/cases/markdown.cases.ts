import type { CaseSuite } from '../testing/vitest';

const ESCAPED_HTML = 'raw HTML is written back escaped';

export const markdownSuites: CaseSuite[] = [
  {
    title: 'CommonMark blocks',
    cases: [
      {
        name: 'paragraphs',
        given: 'one\n\ntwo',
        doc: 'doc(paragraph("one"), paragraph("two"))',
      },
      { name: 'soft line break', given: 'line1\nline2' },
      { name: 'hard line break', given: 'a  \nb' },
      { name: 'heading', given: '## Title', doc: 'doc(heading("Title"))' },
      { name: 'bullet list', given: '- a\n- b' },
      { name: 'nested bullet list', given: '- a\n  - b\n- c' },
      { name: 'ordered list', given: '1. a\n2. b' },
      { name: 'ordered list starting elsewhere', given: '3. a\n4. b' },
      { name: 'blockquote', given: '> quote' },
      { name: 'thematic break', given: 'a\n\n---\n\nb' },
      { name: 'fenced code', given: '```js\nconst a = 1;\n```' },
      {
        name: 'closing hashes of a heading',
        given: '#### Heading ####',
        fails: 'the closing sequence is dropped',
      },
      {
        name: 'star bullets',
        given: '* a\n* b',
        fails: 'bullets are rewritten as "-"',
      },
      {
        name: 'setext heading',
        given: 'Title\n=====',
        fails: 'rewritten as an ATX heading',
      },
      {
        name: 'two blank lines between blocks',
        given: 'a\n\n\nb',
        fails: 'blank lines are collapsed',
      },
    ],
  },
  {
    title: 'CommonMark inlines',
    cases: [
      { name: 'emphasis and strong', given: 'a *b* **c**' },
      { name: 'inline code', given: 'a `b` c' },
      { name: 'link', given: '[site](https://example.com)' },
      { name: 'image', given: '![alt](a.png "title")' },
      {
        name: 'underscore emphasis',
        given: 'a _b_ c',
        fails: 'emphasis is rewritten with "*"',
      },
      {
        name: 'escaped punctuation',
        given: '1\\. not a list',
        fails: 'the backslash is dropped',
      },
      {
        name: 'escaped emphasis',
        given: 'a \\*b\\* c',
        fails: 'the backslash is dropped',
      },
    ],
  },
  {
    title: 'GFM',
    cases: [
      { name: 'strikethrough', given: 'a ~~b~~ c' },
      { name: 'bare URL', given: 'see https://example.com now' },
      {
        name: 'table',
        given: '| a | b |\n| --- | --- |\n| 1 | 2 |',
        fails: 'the table is dropped',
      },
      {
        name: 'task list',
        given: '- [ ] task\n- [x] done',
        fails:
          'the checkbox is lost and the item text falls out of its paragraph',
      },
      {
        name: 'footnote',
        given: 'text[^1]\n\n[^1]: note',
        fails: 'the reference becomes a link and the definition is dropped',
      },
    ],
  },
  {
    title: 'raw HTML',
    cases: [
      {
        name: 'inline element',
        given: 'a <span class="footnote">note</span> b',
        fails: ESCAPED_HTML,
      },
      {
        name: 'empty inline element',
        given: '<a data-ref="fig" href="#f1"></a> shows it',
        fails: ESCAPED_HTML,
      },
      { name: 'line break element', given: 'a<br>b', fails: ESCAPED_HTML },
      {
        name: 'block element around markdown',
        given: '<div class="note">\n\n**md** inside\n\n</div>',
        fails: ESCAPED_HTML,
      },
      {
        name: 'comment',
        given: '<!-- comment -->\n\ntext',
        fails: ESCAPED_HTML,
      },
    ],
  },
  {
    title: 'frontmatter',
    cases: [
      {
        name: 'leading YAML block',
        given: '---\ntitle: x\n---\n\n# h',
        fails: 'frontmatter is dropped from the document',
      },
    ],
  },
];
