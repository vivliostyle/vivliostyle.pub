import { copy, cut, paste, select } from '../../testing/steps';
import type { CaseSuite } from '../../testing/vitest';

const RUBY_HTML =
  '<ruby><span>漢字</span><rt contenteditable="false">かんじ</rt></ruby>';

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
        name: 'the attributes of a footnote reference are copied',
        given: 'あ‸[^1]{.x}‸い\n\n[^1]: 注',
        steps: [copy(), select('あ[^1]{.x}い‸\n\n[^1]: 注'), paste()],
        expect: 'あ[^1]{.x}い[^1]{.x}‸\n\n[^1]: 注',
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
];
