import type { Editor, JSONContent } from '@tiptap/core';

import {
  currentNotations,
  setDocumentNotations,
} from '../../src/markdown/extension';
import { vfmNotations } from '../../src/markdown/notations/vfm/notations';
import { attributedMarkOf, setMarkAttributes } from '../../src/operations/vfm';
import { press, run } from '../../testing/steps';
import type { CaseSuite } from '../../testing/vitest';

const VFM = new Set(vfmNotations().map((it) => it.name));
export const recordWithoutVfm = run(
  'record the document as made without VFM',
  (editor: Editor) => {
    setDocumentNotations(
      editor,
      currentNotations(editor)
        .split(' ')
        .filter((entry) => !VFM.has(entry.split('@')[0]))
        .join(' '),
    );
  },
);

const PLAIN_TEXT = 'kept as plain text';

// What ProseMirror dispatches for pasted text, which the node driver cannot
// paste: paste rules look for the meta.
const paste = (text: string) =>
  run(`paste ${JSON.stringify(text)} as text`, (editor: Editor) => {
    editor.view.dispatch(
      editor.state.tr.insertText(text).setMeta('uiEvent', 'paste'),
    );
  });

const insert = (label: string, content: JSONContent) =>
  run(label, (editor: Editor) => {
    editor.commands.insertContent(content);
  });

const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});

export const vfmSuites: CaseSuite[] = [
  {
    title: 'VFM ruby',
    cases: [
      { name: 'ruby', given: '{漢字|かんじ}を読む' },
      {
        name: 'ruby is a node',
        given: '{漢字|かんじ}を読む',
        doc: 'doc(paragraph(ruby("漢字"), "を読む"))',
        json: [
          {
            type: 'paragraph',
            content: [
              { type: 'ruby', attrs: { rubyText: 'かんじ' } },
              text('を読む'),
            ],
          },
        ],
      },
      {
        name: 'escaped pipe in the base text',
        given: 'a {a\\|b|c} b',
        doc: 'doc(paragraph("a ", ruby("a|b"), " b"))',
      },
      {
        name: 'escaped brace is not ruby',
        given: '\\{a|b}',
        doc: 'doc(paragraph("{a|b}"))',
      },
      {
        name: 'markdown in the base',
        given: '{**漢**字|かんじ}',
        doc: 'doc(paragraph(ruby(bold("漢"), "字")))',
      },
      {
        name: 'ruby text is literal',
        given: '{a|*b* &amp;}',
        json: [
          {
            type: 'paragraph',
            content: [{ type: 'ruby', attrs: { rubyText: '*b* &amp;' } }],
          },
        ],
      },
      {
        name: 'later pipes belong to the ruby text',
        given: '{a|b|c}',
        json: [
          {
            type: 'paragraph',
            content: [{ type: 'ruby', attrs: { rubyText: 'b|c' } }],
          },
        ],
      },
      {
        name: 'not in inline code',
        given: '`{a|b}`',
        doc: 'doc(paragraph(code("{a|b}")))',
      },
      {
        name: 'in a link',
        given: '[{a|b}](u)',
        doc: 'doc(paragraph(link(ruby("a"))))',
      },
      {
        name: 'in bold',
        given: '**{漢字|かんじ}**',
        doc: 'doc(paragraph(bold(ruby("漢字"))))',
      },
      {
        name: 'braces do not pair',
        given: '{{a|b}|c}',
        doc: 'doc(paragraph(ruby("{a"), "|c}"))',
      },
      {
        name: 'the base cannot span lines',
        given: '{a\nb|c}',
        doc: 'doc(paragraph("{a\\nb|c}"))',
      },
      {
        name: 'the base and the ruby text cannot be empty',
        given: '{|b} {a|}',
        doc: 'doc(paragraph("{|b} {a|}"))',
      },
      {
        name: 'between full-width characters',
        given: '漢{字|じ}かな、{振|ふ}り',
        doc: 'doc(paragraph("漢", ruby("字"), "かな、", ruby("振"), "り"))',
      },
      { name: 'in a heading', given: '## {見出し|みだし}' },
      {
        name: 'in a table cell, kept as written',
        given: '| a | b |\n| - | - |\n| {x|y} |',
        doc: 'doc(rawBlock("| a | b |\\n| - | - |\\n| {x|y} |"))',
      },
      {
        name: 'editing next to ruby',
        given: '{漢字|かんじ}を‸',
        steps: ['読む'],
        expect: '{漢字|かんじ}を読む‸',
      },
      {
        name: 'editing the base',
        given: '{漢‸字|かんじ}',
        steps: ['の'],
        expect: '{漢の‸字|かんじ}',
      },
      {
        name: 'a caret put at the end of the base rests after the ruby',
        given: 'a{漢字‸|かんじ}b',
        steps: ['X'],
        expect: 'a{漢字|かんじ}X‸b',
      },
      {
        name: 'a caret put at the start of the base rests before the ruby',
        given: 'a{‸漢字|かんじ}b',
        steps: ['X'],
        expect: 'aX‸{漢字|かんじ}b',
      },
      {
        name: 'one press of the right arrow steps into the base',
        given: 'a‸{漢字|かんじ}b',
        steps: [press('ArrowRight'), 'X'],
        expect: 'a{漢X‸字|かんじ}b',
      },
      {
        name: 'one press of the left arrow steps into the base',
        given: 'a{漢字|かんじ}‸b',
        steps: [press('ArrowLeft'), 'X'],
        expect: 'a{漢X‸字|かんじ}b',
      },
      {
        name: 'one press of the right arrow from the last character of the base steps out of the ruby',
        given: 'a{漢‸字|かんじ}b',
        steps: [press('ArrowRight'), 'X'],
        expect: 'a{漢字|かんじ}X‸b',
      },
      {
        name: 'one press of the left arrow from the first character of the base steps out of the ruby',
        given: 'a{漢‸字|かんじ}b',
        steps: [press('ArrowLeft'), 'X'],
        expect: 'aX‸{漢字|かんじ}b',
      },
      {
        name: 'one press of the right arrow steps over a ruby of one character',
        given: 'a‸{漢|かん}b',
        steps: [press('ArrowRight'), 'X'],
        expect: 'a{漢|かん}X‸b',
      },
      {
        name: 'Backspace right after a ruby takes off the last character of its base',
        given: 'a{漢字|かんじ}‸b',
        steps: [press('Backspace')],
        expect: 'a{漢|かんじ}‸b',
      },
      {
        name: 'Delete right before a ruby takes off the first character of its base',
        given: 'a‸{漢字|かんじ}b',
        steps: [press('Delete')],
        expect: 'a‸{字|かんじ}b',
      },
      {
        name: 'Backspace right after a ruby takes off its only character with the ruby',
        given: 'a{漢|かん}‸b',
        steps: [press('Backspace')],
        expect: 'a‸b',
      },
      {
        name: 'Backspace right after a ruby takes off a whole grapheme',
        given: 'a{漢👍🏽|かん}‸b',
        steps: [press('Backspace')],
        expect: 'a{漢|かん}‸b',
      },
      {
        name: 'a pipe typed into the base is escaped',
        given: '{a‸b|c}',
        steps: ['|'],
        expect: '{a\\|‸b|c}',
      },
      {
        name: 'a pipe that ends the base is written as a reference',
        given: 'x‸',
        steps: [
          insert('insert a ruby whose base ends with a pipe', {
            type: 'ruby',
            attrs: { rubyText: 'b' },
            content: [text('a|')],
          }),
        ],
        expect: 'x{a&#x7C;|b}‸',
      },
      {
        name: 'braces typed next to ruby that make no ruby are not escaped',
        given: '{a|b}‸',
        steps: [' {c|d'],
        expect: '{a|b} {c|d‸',
      },
      {
        name: 'changing the ruby text',
        given: '{漢字|かんじ}‸',
        steps: [
          press('ArrowLeft'),
          run('set the ruby text', (editor) => {
            editor.commands.setRuby('カンジ');
          }),
        ],
        expect: '{漢字|カンジ}',
      },
      {
        name: 'changing the ruby text right after the ruby',
        given: '{漢|かん}‸',
        steps: [
          run('set the ruby text', (editor) => {
            editor.commands.setRuby('カン');
          }),
        ],
        expect: '{漢|カン}‸',
      },
      {
        name: 'making a ruby of the selection',
        given: 'a ‸漢字‸ b',
        steps: [
          run('make a ruby', (editor) => {
            editor.commands.setRuby('かんじ');
          }),
        ],
        expect: 'a {‸漢字‸|かんじ} b',
        doc: 'doc(paragraph("a ", ruby("漢字"), " b"))',
      },
      {
        name: 'no ruby of a selection that holds a ruby',
        given: '‸a {漢字|かんじ} b‸',
        steps: [
          run('make a ruby', (editor) => {
            if (editor.commands.setRuby('x')) {
              throw new Error('The ruby was made');
            }
          }),
        ],
        expect: '‸a {漢字|かんじ} b‸',
      },
      {
        name: 'making a ruby again changes its text',
        given: 'a ‸漢字‸ b',
        steps: [
          run('make a ruby', (editor) => {
            editor.commands.setRuby('かんじ');
          }),
          run('make a ruby', (editor) => {
            editor.commands.setRuby('カンジ');
          }),
        ],
        expect: 'a {‸漢字‸|カンジ} b',
      },
      {
        name: 'inserting a ruby',
        given: 'a‸ b',
        steps: [
          run('insert a ruby', (editor) => {
            editor.commands.insertRuby({ base: '漢字', rubyText: 'かんじ' });
          }),
        ],
        expect: 'a{漢字|かんじ}‸ b',
      },
      {
        name: 'changing the ruby text of a ruby selected around it',
        given: 'a ‸{漢字|かんじ}‸ b',
        steps: [
          run('set the ruby text', (editor) => {
            editor.commands.setRuby('カンジ');
          }),
        ],
        expect: 'a ‸{漢字|カンジ}‸ b',
      },
      {
        name: 'removing a ruby keeps its base',
        given: '**{漢‸字|かんじ}**',
        steps: [
          run('remove the ruby', (editor) => {
            editor.commands.unsetRuby();
          }),
        ],
        expect: '**漢‸字**',
      },
      {
        name: 'a ruby without a base goes away',
        given: '{a‸|b}c',
        steps: [press('Backspace')],
        expect: '‸c',
      },
    ],
  },
  {
    title: 'VFM math',
    cases: [
      {
        name: 'an empty comment between math is no content',
        given: '$x$<!---->$y$ と $$a$$<!---->$$b$$',
        doc: 'doc(paragraph(math, math, " と ", math, math))',
      },
      {
        name: 'a comment with text between math stays raw',
        given: '$x$<!-- c -->$y$',
        doc: 'doc(paragraph(math, rawInline("<!-- c -->"), math))',
      },
      {
        name: 'an empty comment next to other content stays raw',
        given: 'a<!---->$y$ $x$<!---->a',
        doc: 'doc(paragraph("a", rawInline("<!---->"), math, " ", math, rawInline("<!---->"), "a"))',
      },
      {
        // VFM would read the `$` of both as one.
        name: 'math right after math is written after an empty comment',
        given: '$x$a‸$y$',
        steps: [press('Backspace')],
        expect: '$x$<!---->$y$',
        doc: 'doc(paragraph(math, math))',
      },
      {
        name: 'display math right after inline math is written after an empty comment',
        given: '$x$a‸$$y$$',
        steps: [press('Backspace')],
        expect: '$x$<!---->$$y$$',
      },
      {
        name: 'inline math right after display math is written after an empty comment',
        given: '$$x$$a‸$y$',
        steps: [press('Backspace')],
        expect: '$$x$$<!---->$y$',
      },
      {
        name: 'changing math selected around it',
        given: 'a ‸$x$‸ b',
        steps: [
          run('set the math', (editor) => {
            editor.commands.setMath({ latex: 'y', display: false });
          }),
        ],
        expect: 'a $y$ b',
      },
      {
        name: 'inserting display math',
        given: '‸',
        steps: [
          run('insert math', (editor) => {
            editor.commands.setMath({ latex: 'x^2', display: true });
          }),
        ],
        expect: '$$x^2$$‸',
      },
      {
        name: 'math inserted right after math is written after an empty comment',
        given: '$x$‸',
        steps: [
          run('insert math', (editor) => {
            editor.commands.setMath({ latex: 'y', display: false });
          }),
        ],
        expect: '$x$<!---->$y$',
      },
      {
        name: 'the comment goes when the math before it does',
        given: 'a‸$x$<!---->$y$',
        steps: [press('Delete')],
        expect: 'a‸$y$',
      },
      {
        name: 'the comment stays when the text next to it is edited',
        given: '$x$<!---->$y$ a‸',
        steps: ['b'],
        expect: '$x$<!---->$y$ ab‸',
      },
      { name: 'inline math', given: '$x^2$ と' },
      { name: 'display math', given: '$$\ny=1\n$$' },
      {
        name: 'inline math is a node',
        given: '$x^2$ と',
        doc: 'doc(paragraph(math, " と"))',
        json: [
          {
            type: 'paragraph',
            content: [
              { type: 'math', attrs: { latex: 'x^2', display: false } },
              text(' と'),
            ],
          },
        ],
      },
      {
        name: 'display math is a node',
        given: '$$\ny=1\n$$',
        json: [
          {
            type: 'paragraph',
            content: [
              { type: 'math', attrs: { latex: '\ny=1\n', display: true } },
            ],
          },
        ],
      },
      {
        name: 'Backspace right after inline math takes it off whole',
        given: 'a$x^2$‸b',
        steps: [press('Backspace')],
        expect: 'a‸b',
      },
      {
        name: 'editing next to inline math keeps the escapes in it',
        given: 'a $\\{x\\}$ b‸',
        steps: ['c'],
        expect: 'a $\\{x\\}$ bc‸',
      },
      {
        name: 'not math: space after the opening, before the closing, digit after it',
        given: '$ x$ and $x $ and $x$1',
        doc: 'doc(paragraph("$ x$ and $x $ and $x$1"))',
      },
      {
        name: 'escaped dollar is not math',
        given: '\\$x$',
        doc: 'doc(paragraph("$x$"))',
      },
      {
        name: 'closes at the first dollar that can close it',
        given: '$a$b$ and $x$$y$',
        json: [
          {
            type: 'paragraph',
            content: [
              { type: 'math', attrs: { latex: 'a' } },
              text('b$ and '),
              { type: 'math', attrs: { latex: 'x$$y' } },
            ],
          },
        ],
      },
      {
        name: 'spans lines of a paragraph',
        given: '> $a\n> b$ c',
        json: [
          {
            type: 'blockquote',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'math', attrs: { latex: 'a\nb' } },
                  text(' c'),
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'not in inline code',
        given: '`$x$`',
        doc: 'doc(paragraph(code("$x$")))',
      },
      {
        name: 'between full-width characters',
        given: '式$x$です',
        doc: 'doc(paragraph("式", math, "です"))',
      },
      { name: 'prices are not math', given: '$5 と $10' },
      {
        name: 'a digit typed after math is written as a reference',
        given: '$x$‸',
        steps: ['1'],
        expect: '$x$&#x31;‸',
      },
      {
        name: 'a dollar typed next to math is escaped',
        given: '$x$ a‸',
        steps: [
          run('insert dollars without input rules', (editor) => {
            editor.view.dispatch(editor.state.tr.insertText('$y$'));
          }),
        ],
        expect: '$x$ a\\$y\\$‸',
      },
      {
        name: 'a dollar typed into raw HTML before math',
        given: 'a <span class="x">t</span> b $y$‸',
        steps: [
          run('type a dollar into the tag', (editor) => {
            let at = -1;
            editor.state.doc.descendants((node, pos) => {
              if (at === -1 && node.isText && node.text?.includes('cla')) {
                at = pos + node.text.indexOf('cla') + 3;
              }
            });
            editor.view.dispatch(editor.state.tr.insertText('$', at));
          }),
        ],
        expect: 'a <span cla$ss="x">t</span> b $y$',
      },
      {
        name: 'inserting math',
        given: 'a‸',
        steps: [
          run('insert math', (editor) => {
            editor.commands.setMath({ latex: 'E=mc^2', display: false });
          }),
        ],
        expect: 'a$E=mc^2$‸',
      },
    ],
  },
  {
    title: 'VFM attributes',
    cases: [
      {
        name: 'attributes given to a link',
        given: 'a [‸b‸](u) c',
        steps: [
          run('give the link attributes', (editor) => {
            const target = attributedMarkOf(editor.state);
            if (!target || !setMarkAttributes(editor, target, { class: 'x' })) {
              throw new Error('The attributes were not given');
            }
          }),
        ],
        expect: 'a ‸[b](u){.x}‸ c',
      },
      { name: 'heading attributes', given: '# 見出し {#id .cls}' },
      {
        name: 'heading attributes are attributes',
        given: '# 見出し {#id .cls}',
        json: [
          {
            type: 'heading',
            attrs: { level: 1, id: 'id', class: 'cls' },
            content: [{ type: 'text', text: '見出し' }],
          },
        ],
        fails: PLAIN_TEXT,
      },
      {
        name: 'image attributes',
        given: '![cap](a.png){width=100}',
        json: [
          {
            type: 'image',
            attrs: { src: 'a.png', attributes: { width: '100' } },
          },
        ],
      },
      {
        name: 'inline attributes',
        given: '**s**{.x}',
        json: [
          {
            type: 'paragraph',
            content: [
              text('s', [
                { type: 'bold', attrs: { attributes: { class: 'x' } } },
              ]),
            ],
          },
        ],
      },
      {
        name: 'on inline code, strikethrough and links',
        given: '`c`{.y} ~~d~~{.z} [l](u){target=_blank}',
        json: [
          {
            type: 'paragraph',
            content: [
              text('c', [
                { type: 'code', attrs: { attributes: { class: 'y' } } },
              ]),
              text(' '),
              text('d', [
                { type: 'strike', attrs: { attributes: { class: 'z' } } },
              ]),
              text(' '),
              text('l', [
                {
                  type: 'link',
                  attrs: { href: 'u', attributes: { target: '_blank' } },
                },
              ]),
            ],
          },
        ],
      },
      {
        name: 'ids, classes and quoted values',
        given: '*e*{#i .a .b k="v w" flag}',
        json: [
          {
            type: 'paragraph',
            content: [
              text('e', [
                {
                  type: 'italic',
                  attrs: {
                    attributes: { id: 'i', class: 'a b', k: 'v w', flag: '' },
                  },
                },
              ]),
            ],
          },
        ],
      },
      {
        name: 'not after a space',
        given: '**s** {.x}',
        doc: 'doc(paragraph(bold("s"), " {.x}"))',
      },
      {
        name: 'not on a paragraph',
        given: 'para {.x}',
        doc: 'doc(paragraph("para {.x}"))',
      },
      {
        name: 'not when the braces do not hold attributes',
        given: '**s**{k=v=w}',
        doc: 'doc(paragraph(bold("s"), "{k=v=w}"))',
      },
      {
        name: 'braces after a character that ends no element are ruby',
        given: 'x*{a|b}',
        doc: 'doc(paragraph("x*", ruby("a")))',
      },
      {
        name: 'braces after an element are attributes, not ruby',
        given: '**s**{a|b}',
        json: [
          {
            type: 'paragraph',
            content: [
              text('s', [
                { type: 'bold', attrs: { attributes: { 'a|b': '' } } },
              ]),
            ],
          },
        ],
      },
      {
        name: 'on the outer of two elements that end together',
        given: '***a***{.x}',
        json: [
          {
            type: 'paragraph',
            content: [
              text('a', [
                { type: 'italic', attrs: { attributes: { class: 'x' } } },
                { type: 'bold', attrs: { attributes: null } },
              ]),
            ],
          },
        ],
      },
      { name: 'empty attributes', given: '**s**{}' },
      {
        name: 'editing inside an element with attributes',
        given: '**a‸b**{.x}',
        steps: ['c'],
        expect: '**ac‸b**{.x}',
      },
      {
        name: 'attributes of an element without a definition are kept',
        given: '[r][d]{.x} a‸\n\n[d]: u',
        steps: ['b'],
        expect: '[r][d]{.x} ab‸\n\n[d]: u',
      },
      {
        name: 'braces typed after an element are escaped',
        given: '`c`‸',
        steps: [
          run('insert braces without input rules', (editor) => {
            editor.view.dispatch(
              editor.state.tr.setStoredMarks([]).insertText('{.x}'),
            );
          }),
        ],
        expect: '`c`\\{.x}‸',
      },
    ],
  },
  {
    title: 'VFM footnotes',
    cases: [
      { name: 'inline footnote', given: 'inline^[脚注] text' },
      {
        name: 'inline footnote is a node',
        given: 'inline^[脚注 *md*] text',
        doc: 'doc(paragraph("inline", inlineFootnote("脚注 ", italic("md")), " text"))',
      },
      {
        name: 'brackets in a note pair',
        given: 'x^[a [b] c] d',
        doc: 'doc(paragraph("x", inlineFootnote("a [b] c"), " d"))',
      },
      {
        name: 'a bracket in code does not end a note',
        given: 'x^[a `]` b]',
        doc: 'doc(paragraph("x", inlineFootnote("a ", code("]"), " b")))',
      },
      {
        name: 'a note spans lines of a paragraph',
        given: '- x^[a\n  *b*] c',
        doc: 'doc(bulletList(listItem(paragraph("x", inlineFootnote("a\\n", italic("b")), " c"))))',
      },
      {
        name: 'escaped caret is not a note',
        given: 'x\\^[a]',
        doc: 'doc(paragraph("x^[a]"))',
      },
      {
        name: 'empty note',
        given: 'x^[]',
        doc: 'doc(paragraph("x", inlineFootnote))',
      },
      {
        name: 'ruby and math in a note',
        given: 'x^[{a|b} $y$]',
        doc: 'doc(paragraph("x", inlineFootnote(ruby("a"), " ", math)))',
      },
      {
        name: 'footnote reference and definition',
        given: '脚注[^1]です。\n\n[^1]: 本文',
        doc: 'doc(paragraph("脚注", footnoteReference, "です。"), rawBlock("[^1]: 本文"))',
      },
      {
        name: 'a reference without a definition',
        given: 'a[^note] b',
        json: [
          {
            type: 'paragraph',
            content: [
              text('a'),
              { type: 'footnoteReference', attrs: { label: 'note' } },
              text(' b'),
            ],
          },
        ],
      },
      {
        name: 'a reference followed by a resource is a link',
        given: 'a[^1](u)',
        doc: 'doc(paragraph("a", link("^1")))',
      },
      {
        name: 'a label cannot hold spaces',
        given: 'a[^x y]',
        doc: 'doc(paragraph("a[^x y]"))',
      },
      {
        name: 'attributes of a reference',
        given: 'a[^1]{.x}',
        json: [
          {
            type: 'paragraph',
            content: [
              text('a'),
              {
                type: 'footnoteReference',
                attrs: { label: '1', attributes: { class: 'x' } },
              },
            ],
          },
        ],
      },
      {
        name: 'a link whose text looks like a reference with a bracket',
        given: 'x‸',
        steps: [
          insert(
            'insert a link',
            text('^9]', [{ type: 'link', attrs: { href: 'u' } }]),
          ),
        ],
        expect: 'x[^9\\]](u)‸',
      },
      {
        name: 'a reference whose label ends with a backslash',
        given: '[^9\\]x',
        doc: 'doc(paragraph(footnoteReference, "x"))',
      },
      {
        name: 'braces typed after a reference are escaped',
        given: 'a[^1]‸',
        steps: [
          run('insert braces as text', (editor) => {
            editor.view.dispatch(editor.state.tr.insertText('{漢字|かんじ}'));
          }),
        ],
        expect: 'a[^1]\\{漢字|かんじ}‸',
        doc: 'doc(paragraph("a", footnoteReference, "{漢字|かんじ}"))',
      },
      {
        name: 'an empty comment between an element and a ruby is no content',
        given: '[リンク](u)<!---->{漢字|かんじ} **a**<!---->{仮名|かな}',
        doc: 'doc(paragraph(link("リンク"), ruby("漢字"), " ", bold("a"), ruby("仮名")))',
      },
      {
        name: 'empty attributes between an element and a ruby still keep them apart',
        given: '[リンク](u){}{漢字|かんじ}',
        doc: 'doc(paragraph(link("リンク"), ruby("漢字")))',
      },
      {
        name: 'an empty comment before a ruby after text or math stays raw',
        given: 'a<!---->{漢字|かんじ} $x$<!---->{仮名|かな}',
        doc: 'doc(paragraph("a", rawInline("<!---->"), ruby("漢字"), " ", math, rawInline("<!---->"), ruby("仮名")))',
      },
      {
        name: 'ruby right after a reference',
        given: 'a[^1]‸',
        steps: [
          insert('insert a ruby', {
            type: 'ruby',
            attrs: { rubyText: 'かんじ' },
            content: [text('漢字')],
          }),
        ],
        expect: 'a[^1]<!---->{漢字|かんじ}‸',
      },
      {
        name: 'editing a note',
        given: 'x^[a‸c] y',
        steps: ['b'],
        expect: 'x^[ab‸c] y',
      },
      {
        name: 'text typed into an empty note stays in it',
        given: 'x^[‸] y',
        steps: ['ab'],
        expect: 'x^[ab‸] y',
      },
      {
        name: 'a caret put at the end of a note rests after it',
        given: '本文^[注の*内容*‸]が続く。',
        steps: ['X'],
        expect: '本文^[注の*内容*]X‸が続く。',
      },
      {
        name: 'a caret put at the start of a note rests before it',
        given: '本文^[‸注の*内容*]が続く。',
        steps: ['X'],
        expect: '本文X‸^[注の*内容*]が続く。',
      },
      {
        name: 'one press of the right arrow from the last character of a note steps out of it',
        given: '本文^[注の*内‸容*]が続く。',
        steps: [press('ArrowRight'), 'X'],
        expect: '本文^[注の*内容*]X‸が続く。',
      },
      {
        name: 'one press of the left arrow from the first character of a note steps out of it',
        given: '本文^[注‸の*内容*]が続く。',
        steps: [press('ArrowLeft'), 'X'],
        expect: '本文X‸^[注の*内容*]が続く。',
      },
      {
        name: 'one press of the left arrow steps into a note past its last character',
        given: '本文^[注の*内容*]‸が続く。',
        steps: [press('ArrowLeft'), 'X'],
        expect: '本文^[注の*内X‸容*]が続く。',
      },
      {
        name: 'Delete of the last character of a note leaves the caret after it',
        given: 'x^[ab‸c] y',
        steps: [press('Delete'), 'd'],
        expect: 'x^[ab]d‸ y',
      },
      {
        name: 'Backspace of the first character of a note leaves the caret before it',
        given: 'x^[a‸bc] y',
        steps: [press('Backspace'), 'd'],
        expect: 'xd‸^[bc] y',
      },
      {
        name: 'Backspace right after a note takes off its last character',
        given: 'x^[ab]‸ y',
        steps: [press('Backspace')],
        expect: 'x^[a]‸ y',
      },
      {
        name: 'Delete right before a note takes off its first character',
        given: 'x‸^[ab] y',
        steps: [press('Delete')],
        expect: 'x‸^[b] y',
      },
      {
        name: 'Backspace right after a note takes off a line break at its end',
        given: '本文^[注\\\n]‸です。',
        steps: [press('Backspace')],
        expect: '本文^[注]‸です。',
      },
      {
        name: 'Backspace right after a note takes off a ruby in it a character at a time',
        given: 'x^[a{漢字|かんじ}]‸ y',
        steps: [press('Backspace')],
        expect: 'x^[a{漢|かんじ}]‸ y',
      },
      {
        name: 'Backspace right after a note takes off its only character with the note',
        given: 'x^[a]‸ y',
        steps: [press('Backspace')],
        expect: 'x‸ y',
      },
      {
        name: 'Delete right before a note takes off its only character with the note',
        given: 'x‸^[a] y',
        steps: [press('Delete')],
        expect: 'x‸ y',
      },
      {
        name: 'Backspace right after a note takes off a ruby that is all it holds with the note',
        given: 'x^[{漢|かん}]‸ y',
        steps: [press('Backspace')],
        expect: 'x‸ y',
      },
      {
        name: 'Backspace right after an empty note takes it off',
        given: 'x^[]‸ y',
        steps: [press('Backspace')],
        expect: 'x‸ y',
      },
      {
        name: 'line breaks at the end of a note',
        given: '本文^[注‸X]です。',
        steps: [press('Shift-Enter'), press('Shift-Enter'), press('Delete')],
        expect: '本文^[注  \n\\\n]です。',
        doc: 'doc(paragraph("本文", inlineFootnote("注", hardBreak, hardBreak), "です。"))',
      },
      {
        name: 'line breaks at the edges of a note as written',
        given: '本文^[\\\n注\\\n\\\n]です。',
        doc: 'doc(paragraph("本文", inlineFootnote(hardBreak, "注", hardBreak, hardBreak), "です。"))',
      },
      {
        name: 'a bracket typed into a note is escaped',
        given: 'x^[a‸b] y',
        steps: [']'],
        expect: 'x^[a\\]‸b] y',
      },
      {
        name: 'a parenthesis typed after a reference is escaped',
        given: 'a[^1]‸',
        steps: ['(b)'],
        expect: 'a[^1]&#x28;b)‸',
      },
      {
        name: 'making a note of the selection',
        given: 'a ‸note‸ b',
        steps: [
          run('make a note', (editor) => {
            editor.commands.setInlineFootnote();
          }),
        ],
        expect: 'a ^[‸note‸] b',
      },
      {
        name: 'making a note of the selection and taking it off again',
        given: 'a ‸note‸ b',
        steps: [
          run('make a note', (editor) => {
            editor.commands.setInlineFootnote();
          }),
          run('take the note off', (editor) => {
            editor.commands.unsetInlineFootnote();
          }),
        ],
        expect: 'a ‸note‸ b',
      },
      {
        name: 'toggling a note of the selection twice',
        given: 'a ‸note‸ b',
        steps: [
          run('toggle a note', (editor) => {
            editor.commands.toggleInlineFootnote();
          }),
          run('toggle a note', (editor) => {
            editor.commands.toggleInlineFootnote();
          }),
        ],
        expect: 'a ‸note‸ b',
      },
      {
        name: 'toggling a note of part of a note takes the note off',
        given: 'a ^[n‸ot‸e] b',
        steps: [
          run('toggle a note', (editor) => {
            editor.commands.toggleInlineFootnote();
          }),
        ],
        expect: 'a n‸ot‸e b',
      },
      {
        name: 'no note toggled at a caret',
        given: 'a ‸b',
        steps: [
          run('toggle a note', (editor) => {
            if (editor.commands.toggleInlineFootnote()) {
              throw new Error('The note was made');
            }
          }),
        ],
        expect: 'a ‸b',
      },
      {
        name: 'no note of a selection that holds a note',
        given: '‸a ^[b] c‸',
        steps: [
          run('make a note', (editor) => {
            if (editor.commands.setInlineFootnote()) {
              throw new Error('The note was made');
            }
          }),
        ],
        expect: '‸a ^[b] c‸',
      },
      {
        name: 'no note in a note selected around it',
        given: 'a ‸^[b]‸ c',
        steps: [
          run('make a note', (editor) => {
            if (editor.commands.setInlineFootnote()) {
              throw new Error('The note was made');
            }
          }),
        ],
        expect: 'a ‸^[b]‸ c',
      },
      {
        name: 'taking off a note selected around it',
        given: 'a ‸^[b]‸ c',
        steps: [
          run('take the note off', (editor) => {
            editor.commands.unsetInlineFootnote();
          }),
        ],
        expect: 'a ‸b‸ c',
      },
      {
        name: 'toggling a note selected around it takes it off',
        given: 'a ‸^[b]‸ c',
        steps: [
          run('toggle a note', (editor) => {
            editor.commands.toggleInlineFootnote();
          }),
        ],
        expect: 'a ‸b‸ c',
      },
      {
        name: 'no note toggled of a selection that holds a note',
        given: '‸a ^[b] c‸',
        steps: [
          run('toggle a note', (editor) => {
            if (editor.commands.toggleInlineFootnote()) {
              throw new Error('The note was toggled');
            }
          }),
        ],
        expect: '‸a ^[b] c‸',
      },
      {
        name: 'inserting a note with text',
        given: 'a ‸b',
        steps: [
          run('insert a note', (editor) => {
            editor.commands.setInlineFootnote('n');
          }),
        ],
        expect: 'a ^[n]‸b',
      },
      {
        name: 'changing the label of a reference selected around it',
        given: 'a‸[^1]‸ b',
        steps: [
          run('set the label', (editor) => {
            editor.commands.setFootnoteReference('x');
          }),
        ],
        expect: 'a[^x] b',
      },
      {
        name: 'inserting a reference',
        given: 'a‸',
        steps: [
          run('insert a reference', (editor) => {
            editor.commands.setFootnoteReference('2');
          }),
        ],
        expect: 'a[^2]‸',
      },
    ],
  },
  {
    title: 'VFM syntax that emphasis or a link ends first',
    cases: [
      {
        name: 'emphasis around the opening of math',
        given: '*a $b* c$',
        doc: 'doc(paragraph(italic("a $b"), " c$"))',
      },
      {
        name: 'a link around the opening of math',
        given: '[a $b](u) c$',
        doc: 'doc(paragraph(link("a $b"), " c$"))',
      },
      {
        name: 'strong emphasis around the opening of math',
        given: '**a $b** c$',
        doc: 'doc(paragraph(bold("a $b"), " c$"))',
      },
      {
        name: 'emphasis around the opening of ruby',
        given: '*a {b* |c}',
        doc: 'doc(paragraph(italic("a {b"), " |c}"))',
      },
      {
        name: 'a link around the opening of ruby',
        given: '[a {b](u)|c}',
        doc: 'doc(paragraph(link("a {b"), "|c}"))',
      },
      {
        name: 'emphasis around the opening of a note',
        given: '*a ^[b* c]',
        doc: 'doc(paragraph(italic("a ^[b"), " c]"))',
      },
      {
        name: 'closed emphasis before math',
        given: '**a** $b*c$',
        doc: 'doc(paragraph(bold("a"), " ", math))',
      },
      {
        name: 'a single delimiter does not end strong emphasis',
        given: '**$a*b$** ~~$a~b$~~ __重要 $x_1$__',
        doc: 'doc(paragraph(bold(math), " ", strike(math), " ", bold("重要 "), bold(math)))',
      },
      {
        name: 'an underscore before a letter does not end emphasis',
        given: '_a $x_1$ b_ _a {b|c_d} e_',
        doc: 'doc(paragraph(italic("a "), italic(math), italic(" b"), " ", italic("a "), italic(ruby("b")), italic(" e")))',
      },
      {
        name: 'a pair does not end emphasis',
        given: '*a $b**c$ d*',
        doc: 'doc(paragraph(italic("a "), italic(math), italic(" d")))',
      },
      {
        name: 'emphasis around the label of a reference',
        given: '*a [^b*c] d*',
        doc: 'doc(paragraph(italic("a [^b"), "c] d*"))',
      },
      {
        name: 'taking strong emphasis off math keeps the math',
        given: '__重要 $x_1$__ です。‸',
        steps: [
          run('take the strong emphasis off', (editor) => {
            editor.view.dispatch(
              editor.state.tr.removeMark(
                0,
                editor.state.doc.content.size,
                editor.schema.marks.bold,
              ),
            );
          }),
        ],
        expect: '重要 $x_1$ です。‸',
      },
      {
        name: 'no math in the text of a link',
        given: '[$x$](u) $y$',
        doc: 'doc(paragraph(link("$x$"), " ", math))',
      },
      {
        name: 'math in brackets that are no link',
        given: '[$x$] and [x] $a]b$',
        doc: 'doc(paragraph("[", math, "] and [x] ", math))',
      },
    ],
  },
  {
    title: 'VFM next to other syntax',
    cases: [
      {
        name: 'a reference after an exclamation mark',
        given: 'Wow![^1]',
        doc: 'doc(paragraph("Wow!", footnoteReference))',
      },
      {
        name: 'an image whose text looks like a reference',
        given: '![^1](a.png)',
        doc: 'doc(image)',
      },
      {
        name: 'a reference before a parenthesis that closes nothing',
        given: 'a[^1](b',
        doc: 'doc(paragraph("a", footnoteReference, "(b"))',
      },
      {
        name: 'a label holding a bracket',
        given: 'a[^a[b]',
        json: [
          {
            type: 'paragraph',
            content: [
              text('a'),
              { type: 'footnoteReference', attrs: { label: 'a[b' } },
            ],
          },
        ],
      },
      {
        name: 'an id given by a key and then by a hash',
        given: '**s**{id=a #b}',
        json: [
          {
            type: 'paragraph',
            content: [
              text('s', [{ type: 'bold', attrs: { attributes: { id: 'b' } } }]),
            ],
          },
        ],
      },
      {
        name: 'ruby right after strong emphasis',
        given: '**重要**‸',
        steps: [
          insert('insert a ruby', {
            type: 'ruby',
            attrs: { rubyText: 'かんじ' },
            content: [text('漢字')],
          }),
        ],
        expect: '**重要**<!---->{漢字|かんじ}‸',
      },
      {
        name: 'strong emphasis with attributes where its delimiters cannot close',
        given: 'これは‸です',
        steps: [
          insert('insert strong emphasis with attributes', {
            type: 'text',
            text: '「強調」',
            marks: [{ type: 'bold', attrs: { attributes: { class: 'x' } } }],
          }),
        ],
        expect: 'これは<strong class="x">「強調」</strong>‸です',
      },
      {
        name: 'ruby typed right after a link',
        given: '[リンク](u)‸',
        steps: [
          run('type outside the link', (editor) => {
            editor.view.dispatch(editor.state.tr.setStoredMarks([]));
          }),
          '{漢字|かんじ}',
        ],
        expect: '[リンク](u)<!---->{漢字|かんじ}‸',
        doc: 'doc(paragraph(link("リンク"), ruby("漢字")))',
      },
      {
        name: 'ruby that comes right after code as a space goes',
        given: '`c` ‸{漢字|かんじ}',
        steps: [press('Backspace')],
        // The selection's mark would come between them.
        expect: '`c`<!---->{漢字|かんじ}',
      },
      {
        name: 'ruby whose base ends with a backslash',
        given: 'a‸',
        steps: [
          insert('insert a ruby', {
            type: 'ruby',
            attrs: { rubyText: 'c' },
            content: [text('b\\')],
          }),
        ],
        expect: 'a{b&#92;|c}‸',
      },
      {
        name: 'no ruby of a selection over a line break',
        given: 'a‸b  \nc‸d',
        steps: [
          run('make a ruby', (editor) => {
            if (editor.commands.setRuby('x')) {
              throw new Error('The ruby was made');
            }
          }),
        ],
        expect: 'a‸b  \nc‸d',
      },
      {
        name: 'no ruby text that cannot be written',
        given: 'a ‸b‸ c',
        steps: [
          run('make rubies', (editor) => {
            const made = ['', 'x}y', 'x\ny'].filter((text) =>
              editor.can().setRuby(text),
            );
            if (made.length > 0) {
              throw new Error(`Rubies were made with ${made}`);
            }
          }),
        ],
        expect: 'a ‸b‸ c',
      },
      {
        name: 'no labels that cannot be written',
        given: 'a‸',
        steps: [
          run('insert references', (editor) => {
            const made = ['', 'a b', 'a]'].filter((label) =>
              editor.can().setFootnoteReference(label),
            );
            if (made.length > 0) {
              throw new Error(`References were made with ${made}`);
            }
          }),
        ],
        expect: 'a‸',
      },
      {
        name: 'a note in the text of a link',
        given: '[x ^[n]](u) です。',
        doc: 'doc(paragraph(link("x "), link(inlineFootnote("n")), " です。"))',
      },
      {
        name: 'a line break in the base of a ruby',
        given: '{a<br>b|c} {a&#10;b|c}',
        doc: 'doc(paragraph(ruby("a", hardBreak, "b"), " ", ruby("a\\nb")))',
      },
      {
        name: 'a note made in a link leaves the link out',
        given: '[a ‸b‸ c](u)',
        steps: [
          run('make a note', (editor) => {
            editor.commands.setInlineFootnote();
          }),
        ],
        expect: '[a ](u)^[[b](u)][ c](u)',
      },
      {
        name: 'code over math leaves the math out',
        given: '‸a $x$ b‸',
        steps: [
          run('make code', (editor) => {
            editor.view.dispatch(
              editor.state.tr.addMark(
                editor.state.selection.from,
                editor.state.selection.to,
                editor.schema.marks.code.create(),
              ),
            );
          }),
        ],
        expect: '‸`a `$x$` b`‸',
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
      },
      {
        name: 'editing a heading that opens no section',
        given: '## D‸ ##',
        steps: ['x'],
        expect: '## Dx‸ ##',
      },
      {
        name: 'line that closes a section',
        given: '# A\n\ntext\n\n#\n\nafter',
      },
    ],
  },
  {
    title: 'VFM in a document whose definitions lack it',
    cases: [
      {
        name: 'typed syntax stays text',
        given: 'a‸',
        steps: [recordWithoutVfm, '{漢字|かんじ}と$x$ と^[注]'],
        expect: 'a{漢字|かんじ}と$x$ と^[注]‸',
        doc: 'doc(paragraph("a{漢字|かんじ}と$x$ と^[注]"))',
      },
      {
        name: 'pasted syntax becomes what the document can hold',
        given: 'a‸b',
        steps: [
          recordWithoutVfm,
          insert('insert what pasted HTML makes', [
            {
              type: 'ruby',
              attrs: { rubyText: 'かんじ' },
              content: [text('漢字')],
            },
            { type: 'math', attrs: { latex: 'x', display: false } },
            { type: 'footnoteReference', attrs: { label: '1' } },
            { type: 'inlineFootnote', content: [text('注')] },
            text('強調', [
              { type: 'bold', attrs: { attributes: { class: 'x' } } },
            ]),
          ]),
        ],
        expect: 'a漢字$x$[^1]注**強調**‸b',
        doc: 'doc(paragraph("a漢字$x$[^1]注", bold("強調"), "b"))',
      },
      {
        name: 'commands do nothing',
        given: 'a ‸漢字‸ b',
        steps: [
          recordWithoutVfm,
          run('try every command', (editor) => {
            const done = [
              editor.commands.setRuby('かんじ'),
              editor.commands.setMath({ latex: 'x', display: false }),
              editor.commands.setFootnoteReference('1'),
              editor.commands.setInlineFootnote(),
            ];
            if (done.some(Boolean)) {
              throw new Error(`A command ran: ${done}`);
            }
          }),
        ],
        expect: 'a ‸漢字‸ b',
      },
    ],
  },
  {
    title: 'typing VFM',
    cases: [
      {
        name: 'ruby',
        given: '‸',
        steps: ['{漢字|かんじ}'],
        expect: '{漢字|かんじ}‸',
        doc: 'doc(paragraph(ruby("漢字")))',
      },
      {
        name: 'Backspace right after typing a ruby turns it back into what was typed',
        given: '‸',
        steps: ['{漢字|かんじ}', press('Backspace')],
        expect: '\\{漢字\\|かんじ}‸',
      },
      {
        name: 'ruby after text',
        given: 'これは‸',
        steps: ['{漢字|かんじ}です'],
        expect: 'これは{漢字|かんじ}です‸',
        doc: 'doc(paragraph("これは", ruby("漢字"), "です"))',
      },
      {
        name: 'an escaped brace stays text',
        given: '‸',
        steps: ['\\{a|b}'],
        doc: 'doc(paragraph("\\\\{a|b}"))',
        expect: '\\\\\\{a\\|b}‸',
      },
      {
        name: 'inline math',
        given: '‸',
        steps: ['式 $x^2$ です'],
        expect: '式 $x^2$ です‸',
        doc: 'doc(paragraph("式 ", math, " です"))',
      },
      {
        name: 'display math, made when the paragraph ends',
        given: '‸',
        steps: ['$$x$$', press('Enter'), 'y'],
        expect: '$$x$$\n\ny‸',
        json: [
          {
            type: 'paragraph',
            content: [{ type: 'math', attrs: { latex: 'x', display: true } }],
          },
          { type: 'paragraph' },
        ],
      },
      {
        name: 'math waits for the character after it, so typed last it stays text',
        given: '‸',
        steps: ['$x$'],
        expect: '\\$x\\$‸',
        doc: 'doc(paragraph("$x$"))',
      },
      {
        name: 'a digit after the closing dollar keeps a price text',
        given: '‸',
        steps: ['costs $5-$10 and 価格は$10と$20です'],
        expect: 'costs $5-$10 and 価格は$10と$20です‸',
        doc: 'doc(paragraph("costs $5-$10 and 価格は$10と$20です"))',
      },
      {
        name: 'pasted prices stay text',
        given: '‸',
        steps: [paste('costs $5-$10 and $x$.')],
        expect: 'costs \\$5-\\$10 and $x$.‸',
        doc: 'doc(paragraph("costs $5-$10 and ", math, "."))',
      },
      {
        name: 'a price is not math',
        given: '‸',
        steps: ['$5 and $'],
        expect: '$5 and $‸',
        doc: 'doc(paragraph("$5 and $"))',
      },
      {
        name: 'inline footnote',
        given: '本文‸',
        steps: ['^[注]'],
        expect: '本文^[注]‸',
        doc: 'doc(paragraph("本文", inlineFootnote("注")))',
      },
      {
        name: 'text typed after a note closes goes after it',
        given: 'を‸',
        steps: ['^[注です]書く[^1]'],
        expect: 'を^[注です]書く[^1]‸',
        doc: 'doc(paragraph("を", inlineFootnote("注です"), "書く", footnoteReference))',
      },
      {
        name: 'footnote reference',
        given: '本文‸',
        steps: ['[^1]'],
        expect: '本文[^1]‸',
        doc: 'doc(paragraph("本文", footnoteReference))',
      },
      {
        // A definition has no node yet: typed into a paragraph it stays text,
        // instead of the reference node that would hide its label.
        name: 'a reference typed at the start of a paragraph stays text',
        given: '本文[^1]‸',
        steps: [press('Enter'), '[^1]: 注の本文'],
        expect: '本文[^1]\n\n\\[^1]: 注の本文‸',
        doc: 'doc(paragraph("本文", footnoteReference), paragraph("[^1]: 注の本文"))',
      },
      {
        name: 'nothing while composing',
        given: '‸',
        steps: [
          { kind: 'compose', updates: ['{a|b', '{a|b}'], commit: '{a|b}' },
        ],
        expect: '{a|b}‸',
        doc: 'doc(paragraph(ruby("a")))',
      },
      {
        name: 'pasted ruby, math and notes',
        given: '‸',
        steps: [paste('{漢字|かんじ}と$x$と^[注]と[^1]')],
        expect: '{漢字|かんじ}と$x$と^[注]と[^1]‸',
        doc: 'doc(paragraph(ruby("漢字"), "と", math, "と", inlineFootnote("注"), "と", footnoteReference))',
      },
    ],
  },
];
