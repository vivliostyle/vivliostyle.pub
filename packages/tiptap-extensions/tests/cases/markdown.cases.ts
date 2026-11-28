import type { CaseSuite } from '../../testing/vitest';

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
      },
      {
        name: 'star bullets',
        given: '* a\n* b',
      },
      {
        name: 'setext heading',
        given: 'Title\n=====',
      },
      {
        name: 'two blank lines between blocks',
        given: 'a\n\n\nb',
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
      },
      {
        name: 'escaped punctuation',
        given: '1\\. not a list',
      },
      {
        name: 'escaped emphasis',
        given: 'a \\*b\\* c',
      },
    ],
  },
  {
    title: 'GFM',
    cases: [
      { name: 'strikethrough', given: 'a ~~b~~ c' },
      { name: 'bare URL', given: 'see https://example.com now' },
      {
        name: 'a bare URL is a link',
        given: 'a https://a.b b',
        doc: 'doc(paragraph("a ", link("https://a.b"), " b"))',
      },
      {
        name: 'a URL whose domain has no dot is text, as VFM reads it',
        given: 'a https://example https://localhost:3000 b',
        doc: 'doc(paragraph("a https://example https://localhost:3000 b"))',
      },
      {
        name: 'a URL whose domain has an empty part is text, as VFM reads it',
        given: 'a https://a..b https://.a b',
        doc: 'doc(paragraph("a https://a..b https://.a b"))',
      },
      {
        name: 'a URL whose domain starts with other than ASCII is text, as VFM reads it',
        given: 'a https://例え.jp b',
        doc: 'doc(paragraph("a https://例え.jp b"))',
      },
      {
        name: 'a URL whose domain goes on past a dot into other characters is a link, as VFM reads it',
        given: 'a https://a.例 b',
        doc: 'doc(paragraph("a ", link("https://a.例"), " b"))',
      },
      {
        name: 'a www address whose domain has one dot is text, as VFM reads it',
        given: 'a www.a b',
        doc: 'doc(paragraph("a www.a b"))',
      },
      {
        name: 'a www address in capitals is text, as VFM reads it',
        given: 'a WWW.a.b b',
        doc: 'doc(paragraph("a WWW.a.b b"))',
      },
      {
        name: 'table',
        given: '| a | b |\n| --- | --- |\n| 1 | 2 |',
      },
      {
        name: 'task list',
        given: '- [ ] task\n- [x] done',
      },
      {
        name: 'footnote',
        given: 'text[^1]\n\n[^1]: note',
      },
    ],
  },
  {
    title: 'raw HTML',
    cases: [
      {
        name: 'inline element',
        given: 'a <span class="footnote">note</span> b',
      },
      {
        name: 'empty inline element',
        given: '<a data-ref="fig" href="#f1"></a> shows it',
      },
      { name: 'line break element', given: 'a<br>b' },
      {
        name: 'block element around markdown',
        given: '<div class="note">\n\n**md** inside\n\n</div>',
      },
      {
        name: 'comment',
        given: '<!-- comment -->\n\ntext',
      },
    ],
  },
  {
    title: 'frontmatter',
    cases: [
      {
        name: 'leading YAML block',
        given: '---\ntitle: x\n---\n\n# h',
      },
    ],
  },
];
