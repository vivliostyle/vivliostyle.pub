import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

import {
  allThemeNotations,
  currentNotations,
  MARKED_NOTATIONS,
  setDocumentNotations,
  themeBaseNotations,
} from '../markdown';
import { paste, run, type Step } from '../testing/steps';
import type { CaseSuite } from '../testing/vitest';

const THEME_NOTATIONS = new Set(
  [...themeBaseNotations, ...allThemeNotations()].map((it) => it.name),
);

const recordBeforeThemes = run(
  'record the document as made before the markup of themes',
  (editor: Editor) => {
    setDocumentNotations(
      editor,
      currentNotations(editor)
        .split(' ')
        .filter((entry) => !THEME_NOTATIONS.has(entry.split('@')[0] ?? ''))
        .join(' '),
    );
  },
);

const recordMarked = run(
  'record the document as made with marked',
  (editor) => {
    setDocumentNotations(editor, MARKED_NOTATIONS);
  },
);

function command(label: string, apply: (editor: Editor) => boolean): Step {
  return run(label, (editor) => {
    if (!apply(editor)) {
      throw new Error(`Could not ${label}`);
    }
  });
}

function refused(label: string, apply: (editor: Editor) => boolean): Step {
  return run(`not ${label}`, (editor) => {
    if (apply(editor)) {
      throw new Error(`Could ${label}`);
    }
  });
}

function selectNode(name: string): Step {
  return run(`select the ${name}`, (editor) => {
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.type.name === name) {
        at = pos;
      }
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)),
    );
  });
}

function insert(label: string, content: JSONContent | JSONContent[]): Step {
  return run(label, (editor) => {
    editor.commands.insertContent(content);
  });
}

const text = (value: string): JSONContent => ({ type: 'text', text: value });

export const themeSuites: CaseSuite[] = [
  {
    title: 'notes of themes',
    cases: [
      {
        name: 'a note',
        given: '本文<span class="footnote">注の内容</span>です',
        doc: 'doc(paragraph("本文", htmlFootnote("注の内容"), "です"))',
      },
      {
        name: 'markdown in a note',
        given: 'a<span class="footnote">注の**強調**と[リンク](u)</span>',
        doc: 'doc(paragraph("a", htmlFootnote("注の", bold("強調"), "と", link("リンク"))))',
      },
      {
        name: 'other classes and attributes are kept',
        given: 'a<span class="x footnote" id="n1" data-k="v">注</span>',
        json: [
          {
            type: 'paragraph',
            content: [
              text('a'),
              {
                type: 'htmlFootnote',
                attrs: {
                  id: 'n1',
                  otherAttributes: { class: 'x', 'data-k': 'v' },
                },
              },
            ],
          },
        ],
      },
      {
        name: 'an element inside a note',
        given: 'a<span class="footnote">x <span class="tcy">12</span> y</span>',
        doc: 'doc(paragraph("a", htmlFootnote("x ", tcy("12"), " y")))',
      },
      {
        name: 'raw HTML of the same tag inside a note',
        given: 'a<span class="footnote">x <span lang="en">y</span> z</span> b',
        doc: 'doc(paragraph("a", htmlFootnote("x ", rawInline("<span lang=\\"en\\">"), "y", rawInline("</span>"), " z"), " b"))',
      },
      {
        name: 'two notes side by side stay two',
        given:
          'a<span class="footnote">一</span><span class="footnote">二</span>',
        doc: 'doc(paragraph("a", htmlFootnote("一"), htmlFootnote("二")))',
      },
      {
        name: 'a note under emphasis',
        given: '*a<span class="footnote">注</span>b*',
        doc: 'doc(paragraph(italic("a"), italic(htmlFootnote("注")), italic("b")))',
      },
      {
        name: 'a note that is not closed is raw',
        given: 'a<span class="footnote">注',
        doc: 'doc(paragraph("a", rawInline("<span class=\\"footnote\\">"), "注"))',
      },
      {
        name: 'a span of another class is raw',
        given: 'a<span class="note">注</span>',
        doc: 'doc(paragraph("a", rawInline("<span class=\\"note\\">"), "注", rawInline("</span>")))',
      },
      {
        name: 'VFM’s own note stays its syntax',
        given: 'a^[注]と<span class="footnote">注</span>',
        doc: 'doc(paragraph("a", inlineFootnote("注"), "と", htmlFootnote("注")))',
      },
      {
        name: 'typing in a note changes the note alone',
        given: '前の文。本文<span class="footnote">注‸</span>です',
        steps: ['の内容'],
        expect: '前の文。本文<span class="footnote">注の内容‸</span>です',
      },
      {
        name: 'typing after a note keeps it as written',
        given: 'a<span id="n" class="footnote">注</span>b‸',
        steps: ['c'],
        expect: 'a<span id="n" class="footnote">注</span>bc‸',
      },
      {
        name: 'making the selection a note',
        given: '本文‸注の内容‸です',
        steps: [
          command('make it a note', (editor) =>
            editor.commands.setHtmlElement('htmlFootnote'),
          ),
        ],
        expect: '本文‸<span class="footnote">注の内容</span>‸です',
      },
      {
        name: 'inserting a note',
        given: '本文‸です',
        steps: [
          command('insert a note', (editor) =>
            editor.commands.setHtmlElement('htmlFootnote', null, '注'),
          ),
        ],
        expect: '本文<span class="footnote">注</span>‸です',
      },
      {
        name: 'taking a note away keeps its content',
        given: '本文<span class="footnote">注‸の内容</span>です',
        steps: [
          command('take the note away', (editor) =>
            editor.commands.unsetHtmlElement('htmlFootnote'),
          ),
        ],
        expect: '本文注‸の内容です',
      },
    ],
  },
  {
    title: 'cross-references of themes',
    cases: [
      {
        name: 'references of several types',
        given:
          '図<a data-ref="fig" href="#f1"></a>と節<a href="#s" data-ref="sec"></a>',
        doc: 'doc(paragraph("図", crossReference, "と節", crossReference))',
        json: [
          {
            type: 'paragraph',
            content: [
              text('図'),
              {
                type: 'crossReference',
                attrs: { 'data-ref': 'fig', href: '#f1' },
              },
              text('と節'),
              {
                type: 'crossReference',
                attrs: { 'data-ref': 'sec', href: '#s' },
              },
            ],
          },
        ],
      },
      {
        name: 'a reference to another file',
        given: '<a data-ref="sec" href="other.html#intro"></a>を参照',
        json: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'crossReference',
                attrs: { href: 'other.html#intro' },
              },
              text('を参照'),
            ],
          },
        ],
      },
      {
        name: 'a reference with text is raw',
        given: '<a data-ref="fig" href="#f1">図1</a>',
        doc: 'doc(paragraph(rawInline("<a data-ref=\\"fig\\" href=\\"#f1\\">"), "図1", rawInline("</a>")))',
      },
      {
        name: 'a reference without a target is raw',
        given: 'a<a data-ref="fig"></a>',
        doc: 'doc(paragraph("a", rawInline("<a data-ref=\\"fig\\"></a>")))',
      },
      {
        name: 'inserting a reference',
        given: '図‸を見よ',
        steps: [
          command('insert a reference', (editor) =>
            editor.commands.setHtmlElement('crossReference', {
              'data-ref': 'fig',
              href: '#f1',
            }),
          ),
        ],
        expect: '図<a data-ref="fig" href="#f1"></a>‸を見よ',
      },
      {
        name: 'changing a reference',
        given: '図<a data-ref="fig" href="#f1"></a>を見よ‸',
        steps: [
          selectNode('crossReference'),
          command('point it elsewhere', (editor) =>
            editor.commands.setHtmlElement('crossReference', { href: '#f2' }),
          ),
        ],
        expect: '図‸<a data-ref="fig" href="#f2"></a>を見よ',
      },
      {
        name: 'a reference inserted in code splits it',
        given: '`a‸b`',
        steps: [
          command('insert a reference in code', (editor) =>
            editor.commands.setHtmlElement('crossReference', {
              'data-ref': 'fig',
              href: '#f1',
            }),
          ),
        ],
        expect: '`a`<a data-ref="fig" href="#f1"></a>‸`b`',
      },
    ],
  },
  {
    title: 'blocks of themes',
    cases: [
      {
        name: 'a sidenote and its reference',
        given:
          '<aside class="sidenote" id="sn-1">\n\n傍注の**本文**\n\n</aside>\n\n本文<a href="#sn-1" data-ref="sidenote"></a>',
        doc: 'doc(sidenote(paragraph("傍注の", bold("本文"))), paragraph("本文", crossReference))',
      },
      {
        name: 'an equation',
        given: '<div class="equation" id="eq1">\n\n$$\nE = mc^2\n$$\n\n</div>',
        doc: 'doc(equationBlock(paragraph(math)))',
      },
      {
        name: 'a theorem',
        given:
          '<div class="theorem" id="thm1">\n\n**定理** 文。\n\n二段落目。\n\n</div>',
        doc: 'doc(theoremBlock(paragraph(bold("定理"), " 文。"), paragraph("二段落目。")))',
      },
      {
        name: 'a table in a figure with its caption',
        given:
          '<figure class="tbl" id="t1">\n\n<figcaption>表の題</figcaption>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n</figure>',
        doc: 'doc(tableFigure(htmlFigcaption("表の題"), rawBlock("| a | b |\\n| - | - |\\n| 1 | 2 |")))',
      },
      {
        name: 'boxes of the templates',
        given:
          '<div class="note">\n\n**Note:** 本文\n\n</div>\n\n<div class="warning">\n\n注意\n\n</div>',
        doc: 'doc(noteBlock(paragraph(bold("Note:"), " 本文")), warningBlock(paragraph("注意")))',
      },
      {
        name: 'without blank lines the content is not markdown',
        given: '<div class="equation">$$x$$</div>',
        doc: 'doc(rawBlock("<div class=\\"equation\\">$$x$$</div>"))',
      },
      {
        name: 'an element that does not close is raw',
        given: '<div class="note">\n\ntext',
        doc: 'doc(rawBlock("<div class=\\"note\\">"), paragraph("text"))',
      },
      {
        name: 'a div of another class is raw',
        given: '<div class="custom-container">\n\ntext\n\n</div>',
        doc: 'doc(rawBlock("<div class=\\"custom-container\\">"), paragraph("text"), rawBlock("</div>"))',
      },
      {
        name: 'editing inside a block keeps the rest as written',
        given:
          '<div class="note" id="n">\n\n一段落目‸\n\n二段落目\n\n</div>\n\n後',
        steps: ['。'],
        expect:
          '<div class="note" id="n">\n\n一段落目。‸\n\n二段落目\n\n</div>\n\n後',
      },
      {
        name: 'wrapping blocks in a sidenote',
        given: '傍注‸',
        steps: [
          command('wrap it in a sidenote', (editor) =>
            editor.commands.setHtmlElement('sidenote', { id: 'sn-1' }),
          ),
        ],
        expect: '<aside class="sidenote" id="sn-1">\n\n傍注‸\n\n</aside>',
      },
      {
        name: 'taking a block away keeps its content',
        given:
          '<div class="equation">\n\n$$x$$\n\n</div>\n\n<div class="note">\n\na‸\n\n</div>',
        steps: [
          command('take the box away', (editor) =>
            editor.commands.unsetHtmlElement('noteBlock'),
          ),
        ],
        expect: '<div class="equation">\n\n$$x$$\n\n</div>\n\na‸',
      },
    ],
  },
  {
    title: 'captions of themes',
    cases: [
      {
        name: 'captions of figures, tables and code',
        given:
          '<p class="fig-caption" id="c1">図の題</p>\n\n<p class="tbl-caption">表の題</p>\n\n<p class="lst-caption">コードの題</p>',
        doc: 'doc(figureCaption("図の題"), tableCaption("表の題"), listingCaption("コードの題"))',
      },
      {
        name: 'markdown in a caption is text',
        given: '<p class="fig-caption">*題* &amp; \\[x]</p>',
        doc: 'doc(figureCaption("*題* & \\\\[x]"))',
      },
      {
        name: 'a caption holding tags is raw',
        given: '<p class="fig-caption">題 <b>x</b></p>',
        doc: 'doc(rawBlock("<p class=\\"fig-caption\\">題 <b>x</b></p>"))',
      },
      {
        name: 'typing in a caption',
        given: '<p class="fig-caption">図の題‸</p>\n\n後',
        steps: [' <b>&'],
        expect: '<p class="fig-caption">図の題 &lt;b>&amp;‸</p>\n\n後',
      },
      {
        name: 'a blank line in a caption',
        given: '<p class="fig-caption">a‸b</p>',
        steps: [
          run('insert two line feeds', (editor) => {
            editor.view.dispatch(editor.state.tr.insertText('\n\n'));
          }),
        ],
        expect: '<p class="fig-caption">a&#10;\n‸b</p>',
      },
      {
        name: 'making a paragraph a caption',
        given: '図の題‸',
        steps: [
          command('make it a caption', (editor) =>
            editor.commands.setHtmlElement('figureCaption', { id: 'fig-1' }),
          ),
        ],
        expect: '<p class="fig-caption" id="fig-1">図の題‸</p>',
      },
      {
        name: 'a paragraph with marks cannot become a caption',
        given: '**図の題‸**',
        steps: [
          refused('make it a caption', (editor) =>
            editor.commands.setHtmlElement('figureCaption'),
          ),
        ],
        expect: '**図の題**‸',
      },
    ],
  },
  {
    title: 'markup of particular themes',
    cases: [
      {
        name: 'upright, combined and emphasized text',
        given:
          '<span class="tcy">12</span>月、<span class="upright">A</span>と<span class="sesame">圏点</span><span class="sesame_dot">点</span>',
        doc: 'doc(paragraph(tcy("12"), "月、", upright("A"), "と", sesame("圏点"), sesameDot("点")))',
      },
      {
        name: 'a frame',
        given: '<div class="frame">\n\n枠\n\n</div>',
        doc: 'doc(frameBlock(paragraph("枠")))',
      },
      {
        name: 'combining the selection',
        given: '第‸12‸回',
        steps: [
          command('combine it', (editor) =>
            editor.commands.setHtmlElement('tcy'),
          ),
        ],
        expect: '第‸<span class="tcy">12</span>‸回',
      },
    ],
  },
  {
    title: 'markup of themes in a document recorded before it',
    cases: [
      {
        name: 'typed HTML stays text',
        given: 'a‸',
        steps: [recordBeforeThemes, '<span class="footnote">注</span>'],
        expect: 'a\\<span class="footnote">注\\</span>‸',
        doc: 'doc(paragraph("a<span class=\\"footnote\\">注</span>"))',
      },
      {
        name: 'a pasted note is its tags around its content',
        given: 'a‸b',
        steps: [
          recordBeforeThemes,
          insert('insert what pasted HTML makes', [
            {
              type: 'htmlFootnote',
              content: [
                text('注の'),
                { type: 'text', text: '強調', marks: [{ type: 'bold' }] },
              ],
            },
            {
              type: 'crossReference',
              attrs: { 'data-ref': 'fig', href: '#f1' },
            },
          ]),
        ],
        expect:
          'a<span class="footnote">注の**強調**</span><a data-ref="fig" href="#f1"></a>‸b',
        doc: 'doc(paragraph("a", rawInline("<span class=\\"footnote\\">"), "注の", bold("強調"), rawInline("</span><a data-ref=\\"fig\\" href=\\"#f1\\"></a>"), "b"))',
      },
      {
        name: 'a pasted block is its tags around its blocks',
        given: 'a‸',
        steps: [
          recordBeforeThemes,
          insert('insert what pasted HTML makes', [
            {
              type: 'equationBlock',
              attrs: { id: 'eq1' },
              content: [{ type: 'paragraph', content: [text('x')] }],
            },
            {
              type: 'figureCaption',
              content: [text('題 & <')],
            },
          ]),
        ],
        expect:
          'a\n\n<div class="equation" id="eq1">\n\nx\n\n</div>\n\n<p class="fig-caption">題 &amp; &lt;</p>',
        doc: 'doc(paragraph("a"), rawBlock("<div class=\\"equation\\" id=\\"eq1\\">"), paragraph("x"), rawBlock("</div>"), rawBlock("<p class=\\"fig-caption\\">題 &amp; &lt;</p>"))',
      },
      {
        name: 'commands do nothing',
        given: 'a ‸注‸ b',
        steps: [
          recordBeforeThemes,
          refused('make it a note', (editor) =>
            editor.commands.setHtmlElement('htmlFootnote'),
          ),
          refused('combine it', (editor) =>
            editor.commands.setHtmlElement('tcy'),
          ),
        ],
        expect: 'a ‸注‸ b',
      },
      {
        name: 'a block pasted into a document made with marked',
        given: 'a‸',
        steps: [
          recordMarked,
          insert('insert what pasted HTML makes', {
            type: 'noteBlock',
            content: [{ type: 'paragraph', content: [text('x')] }],
          }),
        ],
        expect: 'a\n\n<div class="note">\n\nx\n\n</div>',
      },
    ],
  },
  {
    title: 'pasted markup of themes',
    cases: [
      {
        name: 'pasted HTML of a note',
        given: '本文‸です',
        steps: [
          paste({ html: '<span class="footnote">注の<b>内容</b></span>' }),
        ],
        expect: '本文<span class="footnote">注の**内容**</span>‸です',
      },
      {
        name: 'pasted HTML of VFM’s own note',
        given: '本文‸です',
        steps: [
          paste({
            html: '<span class="footnote" role="doc-footnote">注</span>',
          }),
        ],
        expect: '本文^[注]‸です',
      },
      {
        name: 'pasted HTML of a reference',
        given: '図‸',
        steps: [paste({ html: '<a data-ref="fig" href="#f1"></a>' })],
        expect: '図<a data-ref="fig" href="#f1"></a>‸',
      },
      {
        name: 'a pasted note as text',
        given: '本文‸です',
        steps: [paste({ text: '<span class="footnote">注</span>' })],
        expect: '本文<span class="footnote">注</span>‸です',
      },
    ],
  },
];
