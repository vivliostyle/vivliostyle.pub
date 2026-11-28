import type { Editor } from '@tiptap/core';

import { copy, cut, paste, run, select } from '../../testing/steps';
import type { CaseSuite } from '../../testing/vitest';
import { recordWithoutVfm } from './vfm.cases';

const RUBY_HTML =
  '<ruby><span>漢字</span><rt contenteditable="false">かんじ</rt></ruby>';

const selectImage = run('select the image', (editor: Editor) => {
  editor.commands.setNodeSelection(0);
});

export const clipboardSuites: CaseSuite[] = [
  {
    title: 'Copying a ruby',
    cases: [
      {
        name: 'the whole base of a ruby copies the ruby',
        given: '{‸漢字‸|かんじ}を読む',
        steps: [copy(), select('{漢字|かんじ}を読む‸'), paste()],
        expect: '{漢字|かんじ}を読む{漢字|かんじ}‸',
        clipboard: {
          html: `<p data-pm-slice="1 1 []">${RUBY_HTML}</p>`,
          text: '漢字',
        },
      },
      {
        name: 'a ruby selected from outside it is copied',
        given: '‸{漢字|かんじ}‸を読む',
        steps: [copy(), select('{漢字|かんじ}を読む‸'), paste()],
        expect: '{漢字|かんじ}を読む{漢字|かんじ}‸',
        clipboard: { html: `<p data-pm-slice="1 1 []">${RUBY_HTML}</p>` },
      },
      {
        name: 'a ruby selected from the start of its base to outside it is copied',
        given: '{‸漢字|かんじ}‸を',
        steps: [copy(), select('{漢字|かんじ}を‸'), paste()],
        expect: '{漢字|かんじ}を{漢字|かんじ}‸',
      },
      {
        name: 'a ruby is copied with the text around it',
        given: 'あ‸い{漢字|かんじ}う‸え',
        steps: [copy(), select('あい{漢字|かんじ}うえ‸'), paste()],
        expect: 'あい{漢字|かんじ}うえい{漢字|かんじ}う‸',
        clipboard: {
          html: `<p data-pm-slice="1 1 []">い${RUBY_HTML}う</p>`,
          text: 'い漢字う',
        },
      },
      {
        name: 'part of the base of a ruby copies its text',
        given: '{‸漢‸字|かんじ}を読む',
        steps: [copy(), select('{漢字|かんじ}を読む‸'), paste()],
        expect: '{漢字|かんじ}を読む漢‸',
        clipboard: { html: '<p data-pm-slice="1 1 []">漢</p>', text: '漢' },
      },
      {
        name: 'text and part of a ruby copy the text',
        given: '‸あ{漢‸字|かんじ}',
        steps: [copy(), select('あ{漢字|かんじ}‸'), paste()],
        expect: 'あ{漢字|かんじ}あ漢‸',
      },
      {
        name: 'part of a base keeps the emphasis in it',
        given: '{*‸漢*‸字|かんじ}',
        steps: [copy(), select('{*漢*字|かんじ}‸'), paste()],
        expect: '{*漢*字|かんじ}*漢*‸',
      },
      {
        name: 'a whole base keeps the emphasis in it',
        given: '{‸*漢*字‸|かんじ}',
        steps: [copy(), select('{*漢*字|かんじ}‸'), paste()],
        expect: '{*漢*字|かんじ}{*漢*字|かんじ}‸',
      },
      {
        name: 'a ruby in emphasis keeps the emphasis',
        given: '*a‸{漢字|かんじ}‸b*',
        steps: [copy(), select('*a{漢字|かんじ}b*‸'), paste()],
        expect: '*a{漢字|かんじ}b{漢字|かんじ}*‸',
      },
      {
        name: 'part of a ruby in emphasis copies its text with the emphasis',
        given: '*a{漢‸字|かんじ}b‸*',
        steps: [copy(), select('*a{漢字|かんじ}b*‸'), paste()],
        expect: '*a{漢字|かんじ}b字b*‸',
      },
      {
        name: 'a ruby is copied across paragraphs',
        given: 'あ‸い\n\n{漢字|かんじ}う‸え',
        steps: [copy(), select('あい\n\n{漢字|かんじ}うえ‸'), paste()],
        expect: 'あい\n\n{漢字|かんじ}うえい\n\n{漢字|かんじ}う‸',
      },
      {
        name: 'a ruby pasted over a selection replaces it',
        given: '‸{漢字|かんじ}‸とかな',
        steps: [copy(), select('{漢字|かんじ}と‸かな‸'), paste()],
        expect: '{漢字|かんじ}と{漢字|かんじ}‸',
      },
      {
        name: 'cutting part of a ruby leaves the rest',
        given: '{‸漢‸字|かんじ}を読む',
        steps: [cut()],
        expect: '{字|かんじ}を読む',
        clipboard: { text: '漢' },
      },
      {
        name: 'cutting the whole base of a ruby takes the ruby off',
        given: 'あ{‸漢字‸|かんじ}い',
        steps: [cut()],
        expect: 'あ‸い',
      },
      {
        name: 'a cut ruby pastes back',
        given: 'あ{‸漢字‸|かんじ}い',
        steps: [cut(), paste()],
        expect: 'あ{漢字|かんじ}‸い',
      },
    ],
  },
  {
    title: 'Copying a note',
    cases: [
      {
        name: 'the whole text of a note copies the note',
        given: 'あ^[‸注*釈*‸]い',
        steps: [copy(), select('あ^[注*釈*]い‸'), paste()],
        expect: 'あ^[注*釈*]い^[注*釈*]‸',
        clipboard: {
          html: '<p data-pm-slice="1 1 []"><span class="footnote" role="doc-footnote">注<em>釈</em></span></p>',
          text: '注釈',
        },
      },
      {
        name: 'a note selected from outside it is copied',
        given: 'あ‸^[注釈]‸い',
        steps: [copy(), select('あ^[注釈]い‸'), paste()],
        expect: 'あ^[注釈]い^[注釈]‸',
      },
      {
        name: 'part of the text of a note copies the text',
        given: 'あ^[‸注‸*釈*]い',
        steps: [copy(), select('あ^[注*釈*]い‸'), paste()],
        expect: 'あ^[注*釈*]い注‸',
      },
      {
        name: 'a whole ruby in a note copies the ruby alone',
        given: '^[注{‸漢字‸|かんじ}]',
        steps: [copy(), select('^[注{漢字|かんじ}]‸'), paste()],
        expect: '^[注{漢字|かんじ}]{漢字|かんじ}‸',
      },
      {
        name: 'part of a note keeps the link in it',
        given: 'あ^[‸注[リ‸ンク](https://example.com)]',
        steps: [
          copy(),
          select('あ^[注[リンク](https://example.com)]‸'),
          paste(),
        ],
        expect:
          'あ^[注[リンク](https://example.com)]注[リ](https://example.com)‸',
      },
      {
        name: 'cutting the whole text of a note takes the note off',
        given: 'あ^[‸注釈‸]い',
        steps: [cut()],
        expect: 'あ‸い',
      },
      {
        name: 'a cut note pastes back',
        given: 'あ^[‸注釈‸]い',
        steps: [cut(), paste()],
        expect: 'あ^[注釈]‸い',
      },
      {
        name: 'cutting part of a note leaves the rest',
        given: 'あ^[‸注‸釈]い',
        steps: [cut()],
        expect: 'あ^[釈]い',
      },
    ],
  },
  {
    title: 'Copying a footnote reference',
    cases: [
      {
        name: 'a reference is copied',
        given: 'あ‸[^1]‸い\n\n[^1]: 注',
        steps: [copy(), select('あ[^1]い‸\n\n[^1]: 注'), paste()],
        expect: 'あ[^1]い[^1]‸\n\n[^1]: 注',
        clipboard: {
          html: '<p data-pm-slice="1 1 []"><a id="fnref1" href="#fn1" class="footnote-ref" role="doc-noteref"><sup>1</sup></a></p>',
          text: '[^1]',
        },
      },
      {
        name: 'a reference is copied with the text around it',
        given: '‸あ[^1]い‸\n\n[^1]: 注',
        steps: [copy(), select('あ[^1]い‸\n\n[^1]: 注'), paste()],
        expect: 'あ[^1]いあ[^1]い‸\n\n[^1]: 注',
      },
      {
        name: 'a reference pasted at the start of a paragraph stays one',
        given: 'あ‸[^1]‸\n\nい\n\n[^1]: 注',
        steps: [copy(), select('あ[^1]\n\n‸い\n\n[^1]: 注'), paste()],
        expect: 'あ[^1]\n\n[^1]‸い\n\n[^1]: 注',
      },
    ],
  },
  {
    title: 'Copying math',
    cases: [
      {
        name: 'inline math is copied',
        given: '式‸$x^2$‸です',
        steps: [copy(), select('式$x^2$です‸'), paste()],
        expect: '式$x^2$です$x^2$‸',
        clipboard: {
          html: '<p data-pm-slice="1 1 []"><span class="math inline" data-math-typeset="true">\\(x^2\\)</span></p>',
          text: '$x^2$',
        },
      },
      {
        name: 'math pasted right after math is kept apart from it',
        given: '‸$x$‸',
        steps: [copy(), select('$x$‸'), paste()],
        expect: '$x$<!---->$x$',
      },
      {
        name: 'display math pasted right after display math is kept apart from it',
        given: '‸$$x$$‸',
        steps: [copy(), select('$$x$$‸'), paste()],
        expect: '$$x$$<!---->$$x$$',
      },
      {
        name: 'display math is copied',
        given: '‸$$x$$‸\n\nあい',
        steps: [copy(), select('$$x$$\n\nあ‸い'), paste()],
        expect: '$$x$$\n\nあ$$x$$‸い',
        clipboard: {
          html: '<p data-pm-slice="1 1 []"><span class="math display" data-math-typeset="true">$$x$$</span></p>',
          text: '$$x$$',
        },
      },
    ],
  },
  {
    title: 'Pasting VFM where it cannot be',
    cases: [
      {
        name: 'a ruby pasted into code ends the code',
        given: '‸{漢字|かんじ}‸と`code`',
        steps: [copy(), select('{漢字|かんじ}と`co‸de`'), paste()],
        expect: '{漢字|かんじ}と`co`<!---->{漢字|かんじ}‸`de`',
      },
      {
        name: 'a ruby pasted into a ruby is its base',
        given: '‸{漢字|かんじ}‸と{仮名|かな}',
        steps: [copy(), select('{漢字|かんじ}と{仮‸名|かな}'), paste()],
        expect: '{漢字|かんじ}と{仮漢字‸名|かな}',
      },
      {
        name: 'a ruby pasted into a link ends the link',
        given: '‸{漢字|かんじ}‸と[link](https://example.com)',
        steps: [
          copy(),
          select('{漢字|かんじ}と[li‸nk](https://example.com)'),
          paste(),
        ],
        expect:
          '{漢字|かんじ}と[li](https://example.com)<!---->{漢字|かんじ}‸[nk](https://example.com)',
      },
      {
        name: 'a note pasted into code ends the code',
        given: 'あ‸^[注釈]‸と`code`',
        steps: [copy(), select('あ^[注釈]と`co‸de`'), paste()],
        expect: 'あ^[注釈]と`co`^[注釈]‸`de`',
      },
      {
        name: 'a note pasted into a link ends the link',
        given: 'あ‸^[注釈]‸と[link](https://example.com)',
        steps: [
          copy(),
          select('あ^[注釈]と[li‸nk](https://example.com)'),
          paste(),
        ],
        expect:
          'あ^[注釈]と[li](https://example.com)^[注釈]‸[nk](https://example.com)',
      },
      {
        name: 'a reference pasted into code ends the code',
        given: 'あ‸[^1]‸と`code`\n\n[^1]: 注',
        steps: [copy(), select('あ[^1]と`co‸de`\n\n[^1]: 注'), paste()],
        expect: 'あ[^1]と`co`[^1]‸`de`\n\n[^1]: 注',
      },
      {
        name: 'a reference pasted into a link ends the link',
        given: 'あ‸[^1]‸と[link](https://example.com)\n\n[^1]: 注',
        steps: [
          copy(),
          select('あ[^1]と[li‸nk](https://example.com)\n\n[^1]: 注'),
          paste(),
        ],
        expect:
          'あ[^1]と[li](https://example.com)[^1]‸[nk](https://example.com)\n\n[^1]: 注',
      },
      {
        name: 'math pasted into code ends the code',
        given: '‸$x$‸と`code`',
        steps: [copy(), select('$x$と`co‸de`'), paste()],
        expect: '$x$と`co`$x$‸`de`',
      },
      {
        name: 'math pasted into a link ends the link',
        given: '‸$x$‸と[link](https://example.com)',
        steps: [copy(), select('$x$と[li‸nk](https://example.com)'), paste()],
        expect: '$x$と[li](https://example.com)$x$‸[nk](https://example.com)',
      },
    ],
  },
  {
    title: 'Pasting VFM into other VFM',
    cases: [
      {
        name: 'a note pasted into a ruby stays in it',
        given: 'あ‸^[注釈]‸と{漢字|かんじ}',
        steps: [copy(), select('あ^[注釈]と{漢‸字|かんじ}'), paste()],
        expect: 'あ^[注釈]と{漢^[注釈]‸字|かんじ}',
      },
      {
        name: 'a reference pasted into a ruby stays in it',
        given: 'あ‸[^1]‸と{漢字|かんじ}\n\n[^1]: 注',
        steps: [copy(), select('あ[^1]と{漢‸字|かんじ}\n\n[^1]: 注'), paste()],
        expect: 'あ[^1]と{漢[^1]‸字|かんじ}\n\n[^1]: 注',
      },
      {
        name: 'math pasted into a ruby stays in it',
        given: '‸$x$‸と{漢字|かんじ}',
        steps: [copy(), select('$x$と{漢‸字|かんじ}'), paste()],
        expect: '$x$と{漢$x$‸字|かんじ}',
      },
      {
        name: 'a ruby pasted at the end of a note goes after it',
        given: '‸{漢字|かんじ}‸と^[注]',
        steps: [copy(), select('{漢字|かんじ}と^[注‸]'), paste()],
        expect: '{漢字|かんじ}と^[注]{漢字|かんじ}‸',
      },
      {
        name: 'math pasted at the end of a note goes after it',
        given: '‸$x$‸と^[注]',
        steps: [copy(), select('$x$と^[注‸]'), paste()],
        expect: '$x$と^[注]$x$‸',
      },
    ],
  },
  {
    title: 'Copying attributes',
    cases: [
      {
        name: 'the attributes of strong emphasis are copied',
        given: '‸**太字**{.cls data-x=1 foo=bar}‸と',
        steps: [copy(), select('**太字**{.cls data-x=1 foo=bar}と‸'), paste()],
        expect:
          '**太字**{.cls data-x=1 foo=bar}と**太字**{.cls data-x=1 foo=bar}‸',
        // The editor renders only the attributes a theme can select by.
        clipboard: {
          html: '<p data-pm-slice="1 1 []"><strong class="cls" data-x="1" data-vfm-attributes="{&quot;class&quot;:&quot;cls&quot;,&quot;data-x&quot;:&quot;1&quot;,&quot;foo&quot;:&quot;bar&quot;}">太字</strong></p>',
        },
      },
      {
        name: 'the attributes of emphasis are copied',
        given: '‸*斜体*{.x}‸と',
        steps: [copy(), select('*斜体*{.x}と‸'), paste()],
        expect: '*斜体*{.x}と*斜体*{.x}‸',
      },
      {
        name: 'the attributes of inline code are copied',
        given: '‸`code`{.x}‸と',
        steps: [copy(), select('`code`{.x}と‸'), paste()],
        expect: '`code`{.x}と`code`{.x}‸',
      },
      {
        name: 'the attributes of strikethrough are copied',
        given: '‸~~消し~~{.x}‸と',
        steps: [copy(), select('~~消し~~{.x}と‸'), paste()],
        expect: '~~消し~~{.x}と~~消し~~{.x}‸',
      },
      {
        name: 'the attributes of a link are copied',
        given: '‸[リンク](https://example.com){#id title="a b"}‸と',
        steps: [
          copy(),
          select('[リンク](https://example.com){#id title="a b"}と‸'),
          paste(),
        ],
        expect:
          '[リンク](https://example.com){#id title="a b"}と[リンク](https://example.com){#id title="a b"}‸',
      },
      {
        name: 'a link with attributes pasted into a link ends the link',
        given: '‸[a](https://a.example){.x}‸と[link](https://example.com)',
        steps: [
          copy(),
          select('[a](https://a.example){.x}と[li‸nk](https://example.com)'),
          paste(),
        ],
        expect:
          '[a](https://a.example){.x}と[li](https://example.com)[a](https://a.example){.x}‸[nk](https://example.com)',
      },
      {
        name: 'the attributes of a footnote reference are copied',
        given: 'あ‸[^1]{.x}‸い\n\n[^1]: 注',
        steps: [copy(), select('あ[^1]{.x}い‸\n\n[^1]: 注'), paste()],
        expect: 'あ[^1]{.x}い[^1]{.x}‸\n\n[^1]: 注',
      },
      {
        name: 'the attributes of an image are copied, and its path',
        given: '![画像](a.png){.x width=10 foo=bar}\n\nあ‸',
        steps: [
          selectImage,
          copy(),
          select('![画像](a.png){.x width=10 foo=bar}\n\nあ‸'),
          paste(),
        ],
        expect:
          '![画像](a.png){.x width=10 foo=bar}\n\nあ\n\n![画像](a.png){.x width=10 foo=bar}',
      },
      {
        name: 'quoted values are copied',
        given: '‸**a**{title="x \\"y\\" z" data-k=v}‸',
        steps: [
          copy(),
          select('**a**{title="x \\"y\\" z" data-k=v}‸'),
          paste(),
        ],
        expect: '**aa**{title="x \\"y\\" z" data-k=v}‸',
      },
      {
        name: 'part of emphasis is copied with its attributes',
        given: '**太‸字**{.x}‸',
        steps: [copy(), select('**太字**{.x}‸'), paste()],
        expect: '**太字字**{.x}‸',
      },
      {
        name: 'emphasis next to emphasis with other attributes is written as elements',
        given: '‸**太字**{.x}‸と**別**',
        steps: [copy(), select('**太字**{.x}と**別‸**'), paste()],
        expect:
          '<strong class="x">太字</strong>と<strong>別</strong><strong class="x">太字</strong>‸',
      },
    ],
  },
  {
    title: 'Pasting HTML from elsewhere',
    cases: [
      {
        name: 'a ruby',
        given: 'あ‸',
        steps: [paste({ html: '<ruby>漢字<rt>かんじ</rt></ruby>い' })],
        expect: 'あ{漢字|かんじ}い‸',
      },
      {
        name: 'a ruby at the end',
        given: 'あ‸',
        steps: [paste({ html: 'い<ruby>漢字<rt>かんじ</rt></ruby>' })],
        expect: 'あい{漢字|かんじ}‸',
      },
      {
        name: 'a ruby with fallback parentheses',
        given: '‸',
        steps: [
          paste({
            html: '<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>',
          }),
        ],
        expect: '{漢字|かんじ}‸',
      },
      {
        name: 'a ruby text for each character',
        given: '‸',
        steps: [paste({ html: '<ruby>日<rt>に</rt>本<rt>ほん</rt></ruby>' })],
        expect: '{日|に}{本|ほん}‸',
      },
      {
        name: 'a ruby without ruby text is its base',
        given: '‸',
        steps: [paste({ html: '<ruby>漢字</ruby>' })],
        expect: '漢字‸',
      },
      {
        name: 'a ruby whose ruby text has no markdown is its base',
        given: '‸',
        steps: [paste({ html: '<ruby>a<rt>b}c</rt></ruby>' })],
        expect: 'a‸',
      },
      {
        name: 'a note',
        given: 'あ‸',
        steps: [paste({ html: '<span class="footnote">注</span>い' })],
        expect: 'あ^[注]い‸',
      },
      {
        name: 'a footnote reference',
        given: '‸',
        steps: [
          paste({
            html: '<p>本文<a class="footnote-ref" href="#fn1"><sup>1</sup></a></p>',
          }),
        ],
        expect: '本文[^1]‸',
      },
      {
        name: 'a footnote reference whose label has no markdown is a link',
        given: '‸',
        steps: [
          paste({
            html: '<p>本文<a class="footnote-ref" href="#fn1">a b</a></p>',
          }),
        ],
        expect: '本文[a b](#fn1)‸',
      },
      {
        name: 'math',
        given: '‸',
        steps: [
          paste({
            html: '<span class="math inline" data-math-typeset="true">\\(x\\)</span>',
          }),
        ],
        expect: '$x$‸',
      },
      {
        name: 'display math',
        given: '‸',
        steps: [
          paste({
            html: '<p><span class="math display" data-math-typeset="true">$$x$$</span></p>',
          }),
        ],
        expect: '$$x$$‸',
      },
      {
        name: 'math not typeset by VFM is text',
        given: '‸',
        steps: [paste({ html: '<span class="math inline">\\(x\\)</span>' })],
        expect: '\\\\\\(x\\\\\\)‸',
      },
      {
        name: 'emphasis brings no attributes',
        given: 'あ‸',
        steps: [
          paste({ html: '<strong class="x" id="y" data-z="1">太字</strong>' }),
        ],
        expect: 'あ**太字**‸',
      },
      {
        name: 'a link brings what markdown can hold',
        given: '‸',
        steps: [
          paste({
            html: '<a href="https://example.com" class="c" target="_self" rel="x" title="t">a</a>',
          }),
        ],
        expect: '[a](https://example.com "t")‸',
      },
      {
        name: 'an image brings what markdown can hold',
        given: '‸',
        steps: [
          paste({
            html: '<img src="https://example.com/a.png" alt="a" class="x" width="10">',
          }),
        ],
        expect: '![a](https://example.com/a.png)',
      },
    ],
  },
  {
    title: 'Pasting VFM as plain text',
    cases: [
      {
        name: 'ruby, math and notes',
        given: 'あ‸',
        steps: [paste({ text: '{漢字|かんじ}と$x$と^[注]と[^1]' })],
        expect: 'あ{漢字|かんじ}と$x$と^[注]と[^1]‸',
      },
    ],
  },
  {
    title: 'Pasting attributes as plain text',
    cases: [
      {
        name: 'after strong emphasis',
        given: '‸',
        steps: [paste({ text: '**太字**{.x}' })],
        expect: '**太字**{.x}‸',
        json: [
          {
            type: 'paragraph',
            content: [
              {
                text: '太字',
                marks: [
                  { type: 'bold', attrs: { attributes: { class: 'x' } } },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'after emphasis',
        given: '‸',
        steps: [paste({ text: '*斜体*{#y}' })],
        expect: '*斜体*{#y}‸',
      },
      {
        name: 'after inline code',
        given: '‸',
        steps: [paste({ text: '`code`{.x}' })],
        expect: '`code`{.x}‸',
      },
      {
        name: 'after strikethrough',
        given: '‸',
        steps: [paste({ text: '~~消し~~{.x}' })],
        expect: '~~消し~~{.x}‸',
      },
      {
        name: 'after a footnote reference',
        given: '本文‸\n\n[^1]: 注',
        steps: [paste({ text: '[^1]{.x}' })],
        expect: '本文[^1]{.x}‸\n\n[^1]: 注',
      },
      {
        name: 'after several elements',
        given: '‸',
        steps: [paste({ text: '**a**{.x} と *b*{#y k="v w"}' })],
        expect: '**a**{.x} と *b*{#y k="v w"}‸',
      },
      {
        name: 'after an element in the document',
        given: '**太字**‸',
        steps: [paste({ text: '{.x}' })],
        expect: '**太字**{.x}‸',
        json: [
          {
            type: 'paragraph',
            content: [
              {
                marks: [
                  { type: 'bold', attrs: { attributes: { class: 'x' } } },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'empty braces give none and go',
        given: '‸',
        steps: [paste({ text: '**a**{}b' })],
        expect: '**a**b‸',
      },
      {
        name: 'braces after an element with attributes stay text',
        given: '‸',
        steps: [paste({ text: '**a**{.x}{.y}' })],
        expect: '**a**{.x}{.y}‸',
      },
      {
        name: 'braces after text stay text',
        given: '‸',
        steps: [paste({ text: 'a{.x}' })],
        expect: 'a{.x}‸',
      },
      {
        name: 'braces after a space stay text',
        given: '‸',
        steps: [paste({ text: '**a** {.x}' })],
        expect: '**a** {.x}‸',
      },
      {
        name: 'braces that are not attributes stay text',
        given: '‸',
        steps: [paste({ text: '**a**{=x}' })],
        expect: '**a**{=x}‸',
      },
      {
        name: 'escaped braces stay text',
        given: '‸',
        steps: [paste({ text: '**a**\\{.x}' })],
        expect: '**a**\\\\\\{.x}‸',
      },
      {
        name: 'braces in code stay code',
        given: '‸',
        steps: [paste({ text: '`a{.x}`' })],
        expect: '`a{.x}`‸',
      },
      {
        name: 'a ruby after an element stays a ruby',
        given: '‸',
        steps: [paste({ text: '**a**{漢字|かんじ}' })],
        expect: '**a**<!---->{漢字|かんじ}‸',
      },
      {
        name: 'braces stay text in a document whose definitions lack VFM',
        given: '‸',
        steps: [recordWithoutVfm, paste({ text: '**a**{.x}' })],
        expect: '**a**{.x}‸',
        doc: 'doc(paragraph(bold("a"), "{.x}"))',
      },
    ],
  },
  {
    title: 'Pasting VFM into a document whose definitions lack it',
    cases: [
      {
        name: 'pasted HTML becomes what the document can hold',
        given: 'あ‸',
        steps: [
          recordWithoutVfm,
          paste({
            html: `<p>${RUBY_HTML}<span class="math inline" data-math-typeset="true">\\(x\\)</span><span class="footnote">注</span><strong data-vfm-attributes="{&quot;class&quot;:&quot;x&quot;}">太字</strong></p>`,
          }),
        ],
        expect: 'あ漢字$x$注**太字**‸',
      },
    ],
  },
  {
    title: 'Copying raw markdown',
    cases: [
      {
        name: 'raw markdown stays raw',
        given: '‸<span>a</span>‸と',
        steps: [copy(), select('<span>a</span>と‸'), paste()],
        expect: '<span>a</span>と<span>a</span>‸',
      },
    ],
  },
];
