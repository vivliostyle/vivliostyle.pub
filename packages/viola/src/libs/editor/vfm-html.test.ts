import { Editor } from '@tiptap/core';
import { type StringifyMarkdownOptions, stringify } from '@vivliostyle/vfm';
import { htmlToDOM } from 'html-react-parser';
import { afterAll, describe, expect, it } from 'vitest';

import {
  documentIds,
  PubExtensions,
  parseMarkdown,
} from '@v/tiptap-extensions';
import { documentHtml } from '@v/tiptap-extensions/testing/html';

type DomNode = ReturnType<typeof htmlToDOM>[number];

const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr']);
// Whitespace between the children of these is not rendered.
const CONTAINERS = new Set([
  'aside',
  'blockquote',
  'div',
  'figure',
  'li',
  'ol',
  'section',
  'table',
  'tbody',
  'thead',
  'tr',
  'ul',
]);

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function canonical(nodes: readonly DomNode[], container: boolean): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') {
        const { data } = node as unknown as { data: string };
        return container && /^\s*$/.test(data) ? '' : escapeText(data);
      }
      if (node.type === 'comment') {
        return `<!--${(node as unknown as { data: string }).data}-->`;
      }
      const { name, attribs, children } = node as unknown as {
        name: string;
        attribs: Record<string, string>;
        children: DomNode[];
      };
      const attributes = Object.entries(attribs)
        // The editor's own, which VFM never writes.
        .filter(
          ([key]) => key !== 'contenteditable' && key !== 'data-pub-element',
        )
        .map(([key, value]) => [
          key,
          key === 'class'
            ? value.split(/\s+/).filter(Boolean).sort().join(' ')
            : value,
        ])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => ` ${key}="${value.replace(/"/g, '&quot;')}"`)
        .join('');
      const inner = canonical(children, CONTAINERS.has(name));
      return VOID.has(name) && !inner
        ? `<${name}${attributes}>`
        : `<${name}${attributes}>${inner}</${name}>`;
    })
    .join('');
}

/** HTML with attributes and classes sorted and unrendered whitespace left out. */
function normalize(html: string): string {
  return canonical(htmlToDOM(html), true);
}

const editor = new Editor({
  element: null,
  extensions: [PubExtensions.configure({})],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
});

afterAll(() => {
  editor.destroy();
});

// The editor resolves an image against the project, where VFM leaves it to
// the page.
function editorHtml(markdown: string): string {
  return normalize(
    documentHtml(parseMarkdown(editor, markdown).doc).replaceAll(
      'src="/vivliostyle/',
      'src="',
    ),
  );
}

function vfmHtml(
  markdown: string,
  options: StringifyMarkdownOptions = {},
): string {
  return normalize(
    stringify(markdown, { partial: true, disableFormatHtml: true, ...options }),
  );
}

interface Comparison {
  markdown: string;
  options?: StringifyMarkdownOptions;
  /**
   * Where the editor's elements are not VFM's: both sides as they are now,
   * so a change on either side shows.
   */
  differs?: { vfm: string; editor: string; reason: string };
}

const RUBY_BASE =
  'The base is in a span of its own: ProseMirror edits it in an element of its own, which the ruby text follows.';
const SECTION =
  'VFM wraps a heading in a section, and gives every heading an id, which the editor sets as decorations: they depend on the headings before.';
const DEFINITION_IN_PLACE =
  'VFM collects the definitions of the notes referred to at the end of the document; the editor shows each where it is written, which is where it is edited.';
const CODE_DECORATIONS =
  'The editor highlights code with decorations rather than spans in its content, and keeps the info string as written on the element.';
const TASK_DECORATIONS =
  'The checkbox and the class of the list are decorations, which follow the items, and a list item always holds a paragraph in the editor.';
const ONLY_LISTED =
  'The editor puts on its elements only the attributes a theme can select them by and that do not change how the editor behaves; the document keeps the others.';
const LINK_TARGET =
  "TipTap's link mark opens links in a new tab, with a rel that keeps the page it opens from the editor.";

const comparisons: Record<string, Comparison[]> = {
  CommonMark: [
    { markdown: 'one\n\ntwo' },
    { markdown: 'line1\nline2' },
    { markdown: 'a *b* **c** `d`' },
    { markdown: '> quote\n>\n> more' },
    { markdown: 'a\n\n---\n\nb' },
    {
      markdown: 'a  \nb',
      differs: {
        vfm: '<p>a<br>\nb</p>',
        editor: '<p>a<br>b</p>',
        reason:
          'The line ending after a hard break is part of the break, not text after it.',
      },
    },
    {
      markdown: '[site](https://example.com) and https://example.com',
      differs: {
        vfm: '<p><a href="https://example.com">site</a> and <a href="https://example.com">https://example.com</a></p>',
        editor:
          '<p><a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">site</a> and <a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">https://example.com</a></p>',
        reason: LINK_TARGET,
      },
    },
    { markdown: '![alt](a.png "t")' },
    {
      markdown: '# Title',
      differs: {
        vfm: '<section class="level1"><h1 id="title">Title</h1></section>',
        editor: '<h1>Title</h1>',
        reason: SECTION,
      },
    },
    {
      markdown: '- a\n- b\n\n1. c',
      differs: {
        vfm: '<ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>',
        editor:
          '<ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li><p>c</p></li></ol>',
        reason:
          'A list item always holds a paragraph in the editor, also in a tight list.',
      },
    },
    {
      markdown: '```js\nconst a = 1;\n```',
      differs: {
        vfm: '<pre class="language-js"><code class="language-js"><span class="keyword token">const</span> a <span class="operator token">=</span> <span class="number token">1</span><span class="punctuation token">;</span></code></pre>',
        editor:
          '<pre class="language-js" data-language="js"><code class="language-js">const a = 1;</code></pre>',
        reason:
          'The editor highlights code with decorations rather than spans in its content.',
      },
    },
    {
      markdown: '***a***{.x}',
      differs: {
        vfm: '<p><strong class="x"><em>a</em></strong></p>',
        editor: '<p><em class="x"><strong>a</strong></em></p>',
        reason:
          'CommonMark nests emphasis inside strong emphasis the other way round from VFM 2, and the attributes go on the outer one.',
      },
    },
    {
      markdown: 'これは**「強調」**です',
      differs: {
        vfm: '<p>これは<strong>「強調」</strong>です</p>',
        editor: '<p>これは**「強調」**です</p>',
        reason:
          'CommonMark does not let emphasis open before or close after punctuation between letters; VFM 2 does, and VFM after it will next to CJK.',
      },
    },
  ],
  GFM: [{ markdown: 'a ~~b~~ c' }, { markdown: 'a ~b~ c' }],
  'raw HTML': [
    { markdown: 'a <u>b</u> c' },
    {
      markdown: 'a <b>c</b> d',
      differs: {
        vfm: '<p>a <b>c</b> d</p>',
        editor:
          '<p>a <code data-raw-inline="">&lt;b&gt;</code>c<code data-raw-inline="">&lt;/b&gt;</code> d</p>',
        reason: 'Markdown the editor has no definition for shows as written.',
      },
    },
  ],
  'VFM ruby': [
    {
      markdown: '{漢字|かんじ}を読む',
      differs: {
        vfm: '<p><ruby>漢字<rt>かんじ</rt></ruby>を読む</p>',
        editor: '<p><ruby><span>漢字</span><rt>かんじ</rt></ruby>を読む</p>',
        reason: RUBY_BASE,
      },
    },
    {
      markdown: '{**漢**字|かんじ}',
      differs: {
        vfm: '<p><ruby><strong>漢</strong>字<rt>かんじ</rt></ruby></p>',
        editor:
          '<p><ruby><span><strong>漢</strong>字</span><rt>かんじ</rt></ruby></p>',
        reason: RUBY_BASE,
      },
    },
    {
      markdown: '{a|b|c} {a\\|b|c}',
      differs: {
        vfm: '<p><ruby>a<rt>b|c</rt></ruby> <ruby>a|b<rt>c</rt></ruby></p>',
        editor:
          '<p><ruby><span>a</span><rt>b|c</rt></ruby> <ruby><span>a|b</span><rt>c</rt></ruby></p>',
        reason: RUBY_BASE,
      },
    },
    {
      markdown: '{{a|b}|c} x*{a|b}',
      differs: {
        vfm: '<p><ruby>{a<rt>b</rt></ruby>|c} x*<ruby>a<rt>b</rt></ruby></p>',
        editor:
          '<p><ruby><span>{a</span><rt>b</rt></ruby>|c} x*<ruby><span>a</span><rt>b</rt></ruby></p>',
        reason: RUBY_BASE,
      },
    },
    { markdown: '\\{a|b} `{a|b}`' },
  ],
  'VFM math': [
    { markdown: '式$x = y$と$$\\sum_i a_i$$' },
    { markdown: '$$\ny=1\n$$' },
    { markdown: '$ x$ $x $ $x$1 \\$x$' },
    { markdown: '$a$b$ and $x$$y$' },
    {
      markdown: '[$x$](u)',
      differs: {
        vfm: '<p><a href="u">$x$</a></p>',
        editor:
          '<p><a href="u" rel="noopener noreferrer nofollow" target="_blank">$x$</a></p>',
        reason: LINK_TARGET,
      },
    },
    {
      markdown: '---\nvfm:\n  math: false\n---\n\n$x$',
      differs: {
        vfm: '<p>$x$</p>',
        editor:
          '<p><span class="inline math" data-math-typeset="true">\\(x\\)</span></p>',
        reason:
          'The editor chooses the definitions a document is read with from the record kept with it, not from its frontmatter, so it reads math even where VFM does not. It writes the source back as it was.',
      },
    },
  ],
  'VFM attributes': [
    {
      markdown: '**s**{.x} *e*{#i .a k="v w"}',
      differs: {
        vfm: '<p><strong class="x">s</strong> <em class="a" id="i" k="v w">e</em></p>',
        editor:
          '<p><strong class="x">s</strong> <em class="a" id="i">e</em></p>',
        reason:
          'The editor puts on its elements only the attributes a theme can select them by and that do not change how the editor behaves; the document keeps the others.',
      },
    },
    { markdown: '`c`{.y} ~~d~~{.z}' },
    { markdown: '**s** {.x} and para {.x}' },
    { markdown: '**s**{onclick=alert(1)}' },
    {
      markdown: '[l](u){target=_blank}',
      differs: {
        vfm: '<p><a href="u" target="_blank">l</a></p>',
        editor:
          '<p><a href="u" rel="noopener noreferrer nofollow" target="_blank">l</a></p>',
        reason: LINK_TARGET,
      },
    },
    { markdown: '![a](b.png){.x}' },
  ],
  'VFM footnotes': [
    { markdown: 'a[^1] b' },
    {
      markdown: 'a[^note] b',
      differs: {
        vfm: '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a> b</p>',
        editor:
          '<p>a<a class="footnote-ref" href="#fnnote" id="fnrefnote" role="doc-noteref"><sup>note</sup></a> b</p>',
        reason:
          'VFM numbers references in the order of the book; the editor shows their labels.',
      },
    },
    {
      markdown: 'a[^1] b\n\n[^1]: note',
      differs: {
        vfm: '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a> b</p><section class="footnotes" role="doc-endnotes"><hr><ol><li id="fn1" role="doc-endnote">note<a class="footnote-back" href="#fnref1" role="doc-backlink">↩</a></li></ol></section>',
        editor:
          '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a> b</p><div class="footnote-definition" data-label="1" id="fn1" role="doc-endnote"><p>note</p></div>',
        reason: DEFINITION_IN_PLACE,
      },
    },
    {
      markdown: 'a^[注 *md*] b',
      differs: {
        vfm: '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a> b</p><section class="footnotes" role="doc-endnotes"><hr><ol><li id="fn1" role="doc-endnote">注 <em>md</em><a class="footnote-back" href="#fnref1" role="doc-backlink">↩</a></li></ol></section>',
        editor:
          '<p>a<span class="footnote" role="doc-footnote">注 <em>md</em></span> b</p>',
        reason:
          "The editor shows a note where it is written, as VFM's gcpm mode puts it, instead of collecting it at the end.",
      },
    },
    {
      markdown: '本文^[注\\\n\\\n]です。',
      options: { footnote: 'gcpm' },
      differs: {
        vfm: '<p>本文<span class="footnote" id="fn-1" role="doc-footnote">注<br>\n<br>\n</span>です。</p>',
        editor:
          '<p>本文<span class="footnote" role="doc-footnote">注<br><br></span>です。</p>',
        reason:
          'VFM numbers notes in the order of the book, and the line ending after a hard break is part of the break.',
      },
    },
    // VFM reads braces after a reference as its attributes, which ruby is not.
    { markdown: 'a[^1]{漢|かん}' },
    {
      markdown: 'a[^1]{.x}',
      differs: {
        vfm: '<p>a<sup id="fnref-1"><a class="x" href="#fn-1">1</a></sup></p>',
        editor:
          '<p>a<a class="footnote-ref x" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a></p>',
        reason:
          'VFM renders a reference with attributes as a link in a sup with them, unlike one without; the editor keeps its element and adds the classes.',
      },
    },
    {
      markdown: 'a[^1]{}{漢|かん} [l](u){}{漢|かん} `c`{}{漢|かん}',
      differs: {
        vfm: '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a><ruby>漢<rt>かん</rt></ruby> <a href="u">l</a><ruby>漢<rt>かん</rt></ruby> <code>c</code><ruby>漢<rt>かん</rt></ruby></p>',
        editor:
          '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a><ruby><span>漢</span><rt>かん</rt></ruby> <a href="u" rel="noopener noreferrer nofollow" target="_blank">l</a><ruby><span>漢</span><rt>かん</rt></ruby> <code>c</code><ruby><span>漢</span><rt>かん</rt></ruby></p>',
        reason: RUBY_BASE,
      },
    },
    {
      markdown: 'a^[注 *md*] b',
      options: { footnote: 'gcpm' },
      differs: {
        vfm: '<p>a<span class="footnote" id="fn-1" role="doc-footnote">注 <em>md</em></span> b</p>',
        editor:
          '<p>a<span class="footnote" role="doc-footnote">注 <em>md</em></span> b</p>',
        reason: 'VFM numbers notes in the order of the book.',
      },
    },
  ],
  'VFM next to other syntax': [
    { markdown: '*a $b* c$ と **a $b** c$' },
    { markdown: '*a {b* |c} と *a ^[b* c]' },
    { markdown: '**a** $b*c$ と [x] $a]b$' },
    { markdown: 'Wow![^1]' },
    { markdown: 'a[^1](b' },
    {
      markdown: '[^9\\]](u) と [^9\\]x',
      differs: {
        vfm: '<p><a href="u">^9]</a> と <a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a>x</p>',
        editor:
          '<p><a href="u" rel="noopener noreferrer nofollow" target="_blank">^9]</a> と <a class="footnote-ref" href="#fn9\\" id="fnref9\\" role="doc-noteref"><sup>9\\</sup></a>x</p>',
        reason:
          'VFM numbers references in the order of the book; the editor shows their labels.',
      },
    },
    {
      markdown: '<strong>重要</strong>{漢字|かんじ}',
      differs: {
        vfm: '<p><strong>重要</strong><ruby>漢字<rt>かんじ</rt></ruby></p>',
        editor:
          '<p><strong>重要</strong><ruby><span>漢字</span><rt>かんじ</rt></ruby></p>',
        reason: RUBY_BASE,
      },
    },
    { markdown: '**s**{id=a #b}' },
    {
      markdown: 'a[^a[b]',
      differs: {
        vfm: '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a></p>',
        editor:
          '<p>a<a class="footnote-ref" href="#fna[b" id="fnrefa[b" role="doc-noteref"><sup>a[b</sup></a></p>',
        reason:
          'VFM numbers references in the order of the book; the editor shows their labels.',
      },
    },
    {
      markdown: '[a $b](u) c$ と [a {b](u)|c}',
      differs: {
        vfm: '<p><a href="u">a $b</a> c$ と <a href="u">a {b</a>|c}</p>',
        editor:
          '<p><a href="u" rel="noopener noreferrer nofollow" target="_blank">a $b</a> c$ と <a href="u" rel="noopener noreferrer nofollow" target="_blank">a {b</a>|c}</p>',
        reason: LINK_TARGET,
      },
    },
  ],
  'VFM headings': [
    { markdown: '## D {#x} ##' },
    {
      markdown: '# H1 {#id .cls key=val}',
      differs: {
        vfm: '<section class="level1"><h1 class="cls" id="id" key="val">H1</h1></section>',
        editor: '<h1 class="cls" id="id">H1</h1>',
        reason: `${SECTION} The editor puts only listed attributes on its elements; the document keeps the others.`,
      },
    },
    {
      markdown: '# H1\n{.blk}',
      differs: {
        vfm: '<section class="level1"><h1 class="blk" id="h1">H1</h1></section>',
        editor: '<h1 class="blk">H1</h1>',
        reason: SECTION,
      },
    },
    {
      markdown: '## D ##',
      differs: {
        vfm: '<h2 id="d">D</h2>',
        editor: '<h2>D</h2>',
        reason: SECTION,
      },
    },
    {
      markdown: '# Heading *test* {#foo}',
      differs: {
        vfm: '<section class="level1"><h1 id="heading-test-foo">Heading <em>test</em> {#foo}</h1></section>',
        editor: '<h1>Heading <em>test</em> {#foo}</h1>',
        reason: SECTION,
      },
    },
    {
      markdown: '# H {hidden}',
      differs: {
        vfm: '<section class="level1"><h1 hidden="" id="h">H</h1></section>',
        editor: '<h1 hidden="">H</h1>',
        reason: SECTION,
      },
    },
    {
      markdown: '# A\n\ntext\n\n#\n\nafter',
      differs: {
        vfm: '<section class="level1"><h1 id="a">A</h1><p>text</p></section><p>after</p>',
        editor:
          '<h1>A</h1><p>text</p><div data-section-end="1"></div><p>after</p>',
        reason:
          'VFM ends the section at the line of hashes and writes nothing for it; the editor shows the line, which it edits as a block.',
      },
    },
    {
      markdown: '#\n\nafter',
      differs: {
        vfm: '<section class="level1"><h1 id=""></h1><p>after</p></section>',
        editor: '<div data-section-end="1"></div><p>after</p>',
        reason:
          'A line of hashes that ends no section is an empty heading to VFM; the editor shows it as the line, saying so.',
      },
    },
  ],
  'VFM figures': [
    { markdown: '![cap](a.png)' },
    { markdown: '![](a.png)' },
    { markdown: '![cap *em* \\] &amp;](a.png)' },
    { markdown: 'text ![cap](a.png) more' },
    { markdown: '![a](a.png)![b](b.png)' },
    { markdown: '![cap](a.png){width=100 #i .c}' },
    { markdown: '![cap](a.png){alt="other"}' },
    { markdown: '> ![cap](a.png)' },
    {
      markdown: '[![cap](a.png)](u)',
      differs: {
        vfm: '<p><a href="u"><img alt="cap" src="a.png"></a></p>',
        editor:
          '<p><a href="u" rel="noopener noreferrer nofollow" target="_blank"><img alt="cap" src="a.png"></a></p>',
        reason: LINK_TARGET,
      },
    },
  ],
  'VFM code captions': [
    {
      markdown: '```js:app.js\nconst a = 1;\n```',
      differs: {
        vfm: '<figure class="language-js"><figcaption>app.js</figcaption><pre class="language-js"><code class="language-js"><span class="keyword token">const</span> a <span class="operator token">=</span> <span class="number token">1</span><span class="punctuation token">;</span></code></pre></figure>',
        editor:
          '<figure class="language-js"><figcaption>app.js</figcaption><pre class="language-js" data-language="js:app.js"><code class="language-js">const a = 1;</code></pre></figure>',
        reason: CODE_DECORATIONS,
      },
    },
    {
      markdown: '```js title="my app.js"\nx\n```',
      differs: {
        vfm: '<figure class="language-js"><figcaption>my app.js</figcaption><pre class="language-js"><code class="language-js">x</code></pre></figure>',
        editor:
          '<figure class="language-js"><figcaption>my app.js</figcaption><pre class="language-js" data-language="js title=&quot;my app.js&quot;"><code class="language-js">x</code></pre></figure>',
        reason: CODE_DECORATIONS,
      },
    },
    {
      markdown: '```js title=a {#cid .cc}\nx\n```',
      differs: {
        vfm: '<figure class="language-js"><figcaption>a</figcaption><pre class="language-js"><code class="cc language-js" id="cid">x</code></pre></figure>',
        editor:
          '<figure class="language-js"><figcaption>a</figcaption><pre class="language-js" data-language="js title=a {#cid .cc}"><code class="cc language-js" id="cid">x</code></pre></figure>',
        reason: CODE_DECORATIONS,
      },
    },
    {
      markdown: '```:app.js\nx\n```',
      differs: {
        vfm: '<pre class="language-:app.js"><code class="language-:app.js">x</code></pre>',
        editor:
          '<pre class="language-:app.js" data-language=":app.js"><code class="language-:app.js">x</code></pre>',
        reason: CODE_DECORATIONS,
      },
    },
  ],
  'VFM footnote definitions': [
    {
      markdown: 'a[^1]\n\n[^1]: p1\n\n    p2',
      differs: {
        vfm: '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a></p><section class="footnotes" role="doc-endnotes"><hr><ol><li id="fn1" role="doc-endnote"><p>p1</p><p>p2<a class="footnote-back" href="#fnref1" role="doc-backlink">↩</a></p></li></ol></section>',
        editor:
          '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a></p><div class="footnote-definition" data-label="1" id="fn1" role="doc-endnote"><p>p1</p><p>p2</p></div>',
        reason: DEFINITION_IN_PLACE,
      },
    },
    {
      markdown: '[^1]: def only',
      differs: {
        vfm: '',
        editor:
          '<div class="footnote-definition" data-label="1" id="fn1" role="doc-endnote"><p>def only</p></div>',
        reason:
          'VFM leaves out a definition nothing refers to; the editor keeps it, marked as such.',
      },
    },
    {
      markdown: 'a[^1]\ntext\n[^1]: def',
      differs: {
        vfm: '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a>\ntext\n<a class="footnote-ref" href="#fn1" id="fnref1-1" role="doc-noteref"><sup>1</sup></a>: def</p>',
        editor:
          '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a>\ntext\n<code data-raw-inline="">[^1]: def</code></p>',
        reason:
          'A definition cannot interrupt a paragraph in VFM 2, which reads the line as more of it; micromark reads a definition, which the editor keeps as written in the paragraph.',
      },
    },
  ],
  'VFM table of contents': [
    { markdown: 'text [[toc]]' },
    {
      markdown: '[[toc]]',
      differs: {
        vfm: '<div></div>',
        editor: '<div data-toc=""></div>',
        reason:
          'The attribute lets the editor show where the table of contents goes, which VFM leaves empty.',
      },
    },
    {
      markdown: '[[foo bar=1]]',
      differs: {
        vfm: '',
        editor: '<pre data-raw-block=""><code>[[foo bar=1]]</code></pre>',
        reason:
          'VFM removes shortcodes other than `[[toc]]`; the editor keeps them as written.',
      },
    },
  ],
  'GFM task lists': [
    {
      markdown: '- [ ] task\n- [x] done',
      differs: {
        vfm: '<ul class="contains-task-list"><li class="task-list-item"><input disabled="" type="checkbox"> task</li><li class="task-list-item"><input checked="" disabled="" type="checkbox"> done</li></ul>',
        editor:
          '<ul><li class="task-list-item"><p>task</p></li><li class="task-list-item"><p>done</p></li></ul>',
        reason: TASK_DECORATIONS,
      },
    },
    {
      markdown: '- [ ] a\n\n  para',
      differs: {
        vfm: '<ul class="contains-task-list"><li class="task-list-item"><p><input disabled="" type="checkbox"> a</p><p>para</p></li></ul>',
        editor: '<ul><li class="task-list-item"><p>a</p><p>para</p></li></ul>',
        reason: TASK_DECORATIONS,
      },
    },
  ],
  // VFM 2 ends emphasis where its delimiters next come, as many of them as
  // it opened with, whatever is between: a construct that would hold the end
  // is not read.
  'VFM inside emphasis': [
    ...[
      '**$a*b$** **$x^*$** ~~$a~b$~~ ~~a $b~c$ d~~',
      '_a $x_1$ b_ _$x_i$_ __重要 $x_1$__',
      '*強調* と $x$ **a** $b*c$ snake_case と $x_1$',
      '*a $b* c$',
      '[a $b]c$](u) [a {b|c]d}](u) ![a $b]$](i.png)',
      '*a [^b*c] d*',
      '**a [^b**c] d**',
      '_a [^b_] d_',
      '**a $b**c$ d**',
      '*a $b**c$ d*',
      '_a $b_ c$ d_',
      '_a $b_c$ d_',
      '~~a $b~~c$ d~~',
      '~~a $b ~~c$ d~~',
      '__a $b_c$ d__',
      '*a $b\\*c$ d* **a $b\\**c$ d**',
      '*a $b*$ c*',
      '_a $b_$ c_',
      '*a {b|c*}*',
      '~~a {b|c~~d} e~~',
      '~~a ^[b~~] c~~',
      '**a {b**|c} d**',
    ].map((markdown) => ({ markdown })),
    {
      markdown:
        '_a {b|c_d} e_ **a {b|c*d}** *a* {b|c*d} _a_ {b|c_d} **重要**な{漢字|かんじ} {漢字|かんじ}*強調*',
      differs: {
        vfm: '<p><em>a <ruby>b<rt>c_d</rt></ruby> e</em> <strong>a <ruby>b<rt>c*d</rt></ruby></strong> <em>a</em> <ruby>b<rt>c*d</rt></ruby> <em>a</em> <ruby>b<rt>c_d</rt></ruby> <strong>重要</strong>な<ruby>漢字<rt>かんじ</rt></ruby> <ruby>漢字<rt>かんじ</rt></ruby><em>強調</em></p>',
        editor:
          '<p><em>a <ruby><span>b</span><rt>c_d</rt></ruby> e</em> <strong>a <ruby><span>b</span><rt>c*d</rt></ruby></strong> <em>a</em> <ruby><span>b</span><rt>c*d</rt></ruby> <em>a</em> <ruby><span>b</span><rt>c_d</rt></ruby> <strong>重要</strong>な<ruby><span>漢字</span><rt>かんじ</rt></ruby> <ruby><span>漢字</span><rt>かんじ</rt></ruby><em>強調</em></p>',
        reason: RUBY_BASE,
      },
    },
    {
      markdown: '**a ^[b*c] d** **x ^[n*] y**',
      options: { footnote: 'gcpm' },
      differs: {
        vfm: '<p><strong>a <span class="footnote" id="fn-1" role="doc-footnote">b*c</span> d</strong> <strong>x <span class="footnote" id="fn-2" role="doc-footnote">n*</span> y</strong></p>',
        editor:
          '<p><strong>a <span class="footnote" role="doc-footnote">b*c</span> d</strong> <strong>x <span class="footnote" role="doc-footnote">n*</span> y</strong></p>',
        reason: 'VFM numbers notes in the order of the book.',
      },
    },
  ],
  'markup of themes': [
    { markdown: '本文<span class="footnote">注の**内容**</span>です' },
    {
      markdown:
        'a <span class="x footnote" id="n" data-k="v">b <span class="tcy">12</span> c</span> d',
    },
    {
      markdown:
        'a<span class="footnote" style="color: red" onclick="x()">n</span>',
      differs: {
        vfm: '<p>a<span class="footnote" onclick="x()" style="color: red">n</span></p>',
        editor: '<p>a<span class="footnote">n</span></p>',
        reason: ONLY_LISTED,
      },
    },
    {
      markdown:
        'See <a data-ref="fig" href="#f1"></a> and <a href="#x" data-ref="sec"></a>.',
    },
    {
      markdown: '<a data-ref="fig" href="javascript:alert(1)"></a>',
      differs: {
        vfm: '<p><a data-ref="fig" href="javascript:alert(1)"></a></p>',
        editor: '<p><a data-ref="fig"></a></p>',
        reason:
          'The editor puts on a reference only a link that runs no script: to an id, a relative path or the web. The document keeps the link.',
      },
    },
    { markdown: '<div class="equation" id="eq1">\n\n$$\nx=1\n$$\n\n</div>' },
    { markdown: '<div class="theorem" id="t">\n\n**定理** 本文\n\n</div>' },
    {
      markdown:
        '<aside class="sidenote" id="sn-1">\n\nside **note**\n\n</aside>\n\ntext<a href="#sn-1" data-ref="sidenote"></a>',
    },
    {
      markdown:
        '<figure class="tbl" id="t1">\n\n<figcaption>Cap</figcaption>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n</figure>',
      differs: {
        vfm: '<figure class="tbl" id="t1"><figcaption>Cap</figcaption><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></figure>',
        editor:
          '<figure class="tbl" id="t1"><figcaption>Cap</figcaption><pre data-raw-block=""><code>| a | b |\n|---|---|\n| 1 | 2 |</code></pre></figure>',
        reason:
          'The editor has no definition of GFM tables yet, and keeps one as written.',
      },
    },
    { markdown: '<p class="fig-caption" id="c1">Caption *em* &amp; x</p>' },
    {
      markdown:
        '<p class="tbl-caption">a\nb</p>\n\n<p class="lst-caption">c</p>',
    },
    {
      markdown: '<div class="note">\n\n# Head\n\ntext\n\n</div>',
      differs: {
        vfm: '<div class="note"><section class="level1"><h1 id="head">Head</h1><p>text</p></section></div>',
        editor: '<div class="note"><h1>Head</h1><p>text</p></div>',
        reason: SECTION,
      },
    },
    {
      markdown:
        '<span class="tcy">12</span>月<span class="sesame">圏</span><span class="upright">A</span>',
    },
    { markdown: '<div class="frame">\n\n枠\n\n</div>' },
  ],
  'VFM options': [
    {
      markdown: 'a\nb',
      options: { hardLineBreaks: true },
      differs: {
        vfm: '<p>a<br>\nb</p>',
        editor: '<p>a\nb</p>',
        reason:
          'The editor does not know the VFM options the project is built with.',
      },
    },
  ],
};

describe('elements the editor makes of markdown, compared with VFM', () => {
  for (const [title, cases] of Object.entries(comparisons)) {
    describe(title, () => {
      it.each(cases)('$markdown', ({ markdown, options, differs }) => {
        const vfm = vfmHtml(markdown, options);
        const own = editorHtml(markdown);
        if (!differs) {
          expect(own).toBe(vfm);
          return;
        }
        expect({ vfm, editor: own }).toEqual({
          vfm: differs.vfm,
          editor: differs.editor,
        });
        expect(own).not.toBe(vfm);
      });
    });
  }
});

function vfmHeadingIds(markdown: string): string[] {
  return [
    ...stringify(markdown, { partial: true, disableFormatHtml: true }).matchAll(
      /<h[1-6]\b[^>]*?\bid="([^"]*)"/g,
    ),
  ].map((match) => decodeEntities(match[1] ?? ''));
}

function decodeEntities(text: string): string {
  return htmlToDOM(`<p>${text}</p>`)
    .flatMap(
      (node) => (node as unknown as { children: { data: string }[] }).children,
    )
    .map((child) => child.data)
    .join('');
}

const HEADINGS = [
  '# Hello World!  Foo',
  '# 日本語の見出し\n\n# 日本語の見出し\n\n## 日本語の見出し',
  '# A {#id}\n\n# A\n\n# id',
  '# x\n\n# x {#x-1}\n\n# x',
  '# H {#a.b}\n\n# H {#Foo}',
  '# a ^[note] b\n\n# a[^1] b\n\n[^1]: x',
  '# {漢字|かんじ}\n\n# $x$ math\n\n# `code` here',
  '# ![x](a.png) T\n\n# a<br>b\n\n# [link](u) ~~del~~',
  '# a&amp;b &copy;\n\n# A.B_C-D\n\n# Ⓐ ① ¹',
  '# Über Straße\n\n# CJK　全角スペース\n\n# emoji 🎉 ok',
  '# Heading *test* {#foo}\n\n# *e*{.x} t',
  '# a <span class="footnote">n</span> b\n\n# x<a data-ref="fig" href="#f"></a>y\n\n# <span class="tcy">12</span>月',
  'Setext\n---\n\n# Setext',
  '# A\n\n#\n\n# B\n\n##\n\n## ',
  '> # quoted\n\n- # listed',
];

describe('ids of headings, compared with VFM', () => {
  it.each(HEADINGS)('%j', (markdown) => {
    const ids = documentIds(parseMarkdown(editor, markdown).doc)
      .filter((it) => it.kind === 'heading')
      .map((it) => it.id);
    expect(ids).toEqual(vfmHeadingIds(markdown));
  });
});
