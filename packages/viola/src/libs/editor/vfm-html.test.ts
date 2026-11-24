import { Editor } from '@tiptap/core';
import { type StringifyMarkdownOptions, stringify } from '@vivliostyle/vfm';
import { htmlToDOM } from 'html-react-parser';
import { afterAll, describe, expect, it } from 'vitest';

import { PubExtensions, parseMarkdown } from '@v/tiptap-extensions';
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
        .filter(([key]) => key !== 'contenteditable')
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

function editorHtml(markdown: string): string {
  return normalize(documentHtml(parseMarkdown(editor, markdown).doc));
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
    {
      markdown: '![alt](a.png "t")',
      differs: {
        vfm: '<figure><img alt="alt" src="a.png" title="t"><figcaption aria-hidden="true">alt</figcaption></figure>',
        editor: '<img alt="alt" src="/vivliostyle/a.png" title="t">',
        reason:
          'The editor resolves the image against the project, and makes no figure of an image alone in its paragraph yet.',
      },
    },
    {
      markdown: '# Title',
      differs: {
        vfm: '<section class="level1"><h1 id="title">Title</h1></section>',
        editor: '<h1>Title</h1>',
        reason: 'VFM wraps a heading in a section and gives it an id.',
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
    { markdown: '**s**{.x} *e*{#i .a k="v w"}' },
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
    {
      markdown: '![a](b.png){.x}',
      differs: {
        vfm: '<figure><img alt="a" class="x" src="b.png"><figcaption aria-hidden="true">a</figcaption></figure>',
        editor: '<img alt="a" class="x" src="/vivliostyle/b.png">',
        reason:
          'The editor resolves the image against the project, and makes no figure of an image alone in its paragraph yet.',
      },
    },
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
          '<p>a<a class="footnote-ref" href="#fn1" id="fnref1" role="doc-noteref"><sup>1</sup></a> b</p><pre data-raw-block=""><code>[^1]: note</code></pre>',
        reason:
          'Footnote definitions have no definition in the editor yet and show as written.',
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
