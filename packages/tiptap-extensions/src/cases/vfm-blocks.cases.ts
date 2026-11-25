import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

import {
  currentNotations,
  MARKED_NOTATIONS,
  setDocumentNotations,
} from '../markdown';
import { press, run, type Step } from '../testing/steps';
import type { CaseSuite } from '../testing/vitest';

// The definitions this set of syntax added to those the inline syntax came
// with: a document recorded without them was made before.
const BLOCK_NOTATIONS = new Set([
  'headingAttributes',
  'sectionEnd',
  'tableOfContents',
  'taskList',
  'imageAlt',
  'footnoteDefinition',
  'inlineImage',
]);

const recordInlineEra = run(
  'record the document as made before block VFM syntax',
  (editor: Editor) => {
    setDocumentNotations(
      editor,
      currentNotations(editor)
        .split(' ')
        .filter((entry) => !BLOCK_NOTATIONS.has(entry.split('@')[0] ?? ''))
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

/** Inserts text at the selection without input rules. */
function insert(text: string): Step {
  return run(`insert ${JSON.stringify(text)}`, (editor) => {
    editor.view.dispatch(editor.state.tr.insertText(text));
  });
}

// What ProseMirror dispatches for pasted text, which the node driver cannot
// paste: paste rules look for the meta.
const paste = (text: string) =>
  run(`paste ${JSON.stringify(text)} as text`, (editor: Editor) => {
    editor.view.dispatch(
      editor.state.tr.insertText(text).setMeta('uiEvent', 'paste'),
    );
  });

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

const NEXT_LINE_ONLY =
  'VFM 2 drops `{…}` on the line after a heading that has attributes on its own line; the editor keeps it a paragraph';
const SHORTCODE_TEXT =
  'VFM 2 reads a shortcode that text follows on its line, and the text as a paragraph after it; the editor only reads one alone on its line';

export const vfmBlockSuites: CaseSuite[] = [
  {
    title: 'VFM heading attributes',
    cases: [
      { name: 'id and class', given: '# 見出し {#id .cls}' },
      {
        name: 'the attributes are the heading’s',
        given: '# H1 {#id .cls key=val}',
        json: [
          {
            type: 'heading',
            attrs: {
              level: 1,
              attributes: { id: 'id', class: 'cls', key: 'val' },
            },
            content: [{ type: 'text', text: 'H1' }],
          },
        ],
      },
      {
        name: 'on the next line',
        given: '# H1\n{.blk}\n\npara',
        doc: 'doc(heading("H1"), paragraph("para"))',
        json: [
          { type: 'heading', attrs: { attributes: { class: 'blk' } } },
          { type: 'paragraph' },
        ],
      },
      {
        name: 'on the next line, before more lines of a paragraph',
        given: '# H\n{#x}\npara',
        doc: 'doc(heading("H"), paragraph("para"))',
      },
      {
        name: 'on the next line in a quote',
        given: '> # H\n> {.q}',
        doc: 'doc(blockquote(heading("H")))',
      },
      {
        name: 'after a blank line it is a paragraph',
        given: '# H1\n\n{.blk}',
        doc: 'doc(heading("H1"), paragraph("{.blk}"))',
      },
      { name: 'hidden', given: '# 隠す {hidden}' },
      {
        name: 'without space before them',
        given: '# H{#x}',
        json: [{ type: 'heading', attrs: { attributes: { id: 'x' } } }],
      },
      {
        name: 'before the closing sequence',
        given: '## D {#x} ##',
        json: [
          {
            type: 'heading',
            attrs: { closingSequence: ' ##', attributes: { id: 'x' } },
          },
        ],
      },
      {
        name: 'after hashes that are no closing sequence then',
        given: '## D ## {#x}',
        doc: 'doc(heading("D ##"))',
        json: [
          {
            type: 'heading',
            attrs: { closingSequence: null, attributes: { id: 'x' } },
          },
        ],
      },
      {
        name: 'after an element they stay text, as in VFM',
        given: '# Heading *test* {#foo}',
        doc: 'doc(heading("Heading ", italic("test"), " {#foo}"))',
      },
      {
        name: 'after text following an element',
        given: '# *b* c {#x}',
        doc: 'doc(heading(italic("b"), " c"))',
      },
      {
        name: 'right after an element they are the element’s',
        given: '# Heading *test*{#foo}',
        json: [
          {
            type: 'heading',
            attrs: { attributes: null },
            content: [
              { type: 'text', text: 'Heading ' },
              {
                type: 'text',
                text: 'test',
                marks: [
                  { type: 'italic', attrs: { attributes: { id: 'foo' } } },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'the last of two',
        given: '# a {#x} {.y}',
        doc: 'doc(heading("a {#x}"))',
      },
      {
        name: 'a quoted value',
        given: '# H {key="a b" .c}',
        json: [
          {
            type: 'heading',
            attrs: { attributes: { class: 'c', key: 'a b' } },
          },
        ],
      },
      {
        name: 'escaped braces are text',
        given: '# a \\{#x}',
        doc: 'doc(heading("a {#x}"))',
      },
      {
        name: 'not on a setext heading',
        given: 'Setext {#s}\n===',
        doc: 'doc(heading("Setext {#s}"))',
      },
      {
        name: 'Japanese text and id',
        given: '# 第一章　はじめに {#はじめに}',
        json: [{ type: 'heading', attrs: { attributes: { id: 'はじめに' } } }],
      },
      {
        name: 'on the next line after attributes of its own',
        given: '# H1 {.a}\n{.b}',
        doc: 'doc(heading("H1"))',
        fails: NEXT_LINE_ONLY,
      },
      {
        name: 'editing the text keeps them',
        given: '# 見出‸ {#id}',
        steps: ['し'],
        expect: '# 見出し‸ {#id}',
      },
      {
        name: 'editing the text keeps them on the next line',
        given: '## 見出‸\n{#id}',
        steps: ['し'],
        expect: '## 見出し‸\n{#id}',
      },
      {
        name: 'setting them',
        given: '# 見出し‸',
        steps: [
          command('set the attributes', (editor) =>
            editor.commands.setHeadingAttributes({ id: 'a', class: 'b c' }),
          ),
        ],
        expect: '# 見出し {#a .b .c}',
      },
      {
        name: 'setting them on a heading that ends with an element',
        given: '# 見出し *強調*‸',
        steps: [
          command('set the attributes', (editor) =>
            editor.commands.setHeadingAttributes({ id: 'a' }),
          ),
        ],
        expect: '# 見出し *強調*\n{#a}',
      },
      {
        name: 'changing them keeps where they are written',
        given: '# 見出し‸\n{#a}',
        steps: [
          command('change the attributes', (editor) =>
            editor.commands.setHeadingAttributes({ id: 'b' }),
          ),
        ],
        expect: '# 見出し\n{#b}',
      },
      {
        name: 'taking them away',
        given: '# 見出し‸ {#a}',
        steps: [
          command('take the attributes away', (editor) =>
            editor.commands.setHeadingAttributes(null),
          ),
        ],
        expect: '# 見出し',
      },
      {
        name: 'none that cannot be written',
        given: '# 見出し‸',
        steps: [
          refused('set attributes with a line break', (editor) =>
            editor.commands.setHeadingAttributes({ title: 'a\nb' }),
          ),
        ],
        expect: '# 見出し',
      },
      {
        name: 'typed at the end of a heading',
        given: '# 見出し‸',
        steps: [' {#id .cls}'],
        expect: '# 見出し {#id .cls}',
        json: [
          {
            type: 'heading',
            attrs: { attributes: { id: 'id', class: 'cls' } },
            content: [{ type: 'text', text: '見出し' }],
          },
        ],
      },
      {
        name: 'braces inserted without the input rule are escaped',
        given: '# 見出し‸',
        steps: [insert(' {#id}')],
        expect: '# 見出し \\{#id}',
      },
      {
        name: 'typed in a document recorded before them, they stay text',
        given: '# 見出し‸',
        steps: [recordInlineEra, ' {#id}'],
        expect: '# 見出し {#id}‸',
        doc: 'doc(heading("見出し {#id}"))',
      },
    ],
  },
  {
    title: 'VFM section ends',
    cases: [
      {
        name: 'a line of hashes ends the section',
        given: '# A\n\ntext\n\n#\n\nafter',
        doc: 'doc(heading("A"), paragraph("text"), sectionEnd, paragraph("after"))',
      },
      {
        name: 'its level',
        given: '# A\n\n## B\n\n##\n\nx',
        json: [
          { type: 'heading' },
          { type: 'heading' },
          { type: 'sectionEnd', attrs: { level: 2 } },
          { type: 'paragraph' },
        ],
      },
      { name: 'one that ends nothing', given: '#\n\nafter' },
      {
        name: 'an empty heading with a closing sequence is a heading',
        given: '# #',
        doc: 'doc(heading)',
      },
      { name: 'in a quote', given: '> #' },
      {
        name: 'an empty heading is saved as one',
        given: '‸',
        steps: ['# '],
        expect: '#',
        doc: 'doc(heading)',
      },
      {
        name: 'Enter after hashes alone',
        given: '‸',
        steps: ['##', press('Enter')],
        expect: '##',
        doc: 'doc(sectionEnd, paragraph)',
      },
      {
        name: 'inserting one',
        given: '# A\n\ntext‸',
        steps: [
          command('insert a section end', (editor) =>
            editor.commands.insertSectionEnd(1),
          ),
        ],
        expect: '# A\n\ntext\n\n#',
      },
      {
        name: 'hashes in a paragraph are escaped',
        given: '‸',
        steps: [insert('#')],
        expect: '\\#',
      },
      {
        name: 'Enter after hashes in a document recorded before them',
        given: '‸',
        steps: [recordInlineEra, '##', press('Enter'), 'x'],
        expect: '## x‸',
      },
    ],
  },
  {
    title: 'VFM footnote definitions',
    cases: [
      { name: 'a definition', given: '本文[^1]\n\n[^1]: 注の本文' },
      {
        name: 'a definition is a node',
        given: '[^note]: 注',
        doc: 'doc(footnoteDefinition(paragraph("注")))',
        json: [{ type: 'footnoteDefinition', attrs: { label: 'note' } }],
      },
      {
        name: 'paragraphs',
        given: 'a[^1]\n\n[^1]: p1\n\n    p2',
        doc: 'doc(paragraph("a", footnoteReference), footnoteDefinition(paragraph("p1"), paragraph("p2")))',
      },
      {
        name: 'a paragraph indented less is not the note’s',
        given: 'a[^1]\n\n[^1]: p1\n\n  p2',
        doc: 'doc(paragraph("a", footnoteReference), footnoteDefinition(paragraph("p1")), paragraph("p2"))',
      },
      {
        name: 'a list and code',
        given: '[^1]:\n    - x\n    - y\n\n    ```js\n    code\n    ```',
        doc: 'doc(footnoteDefinition(bulletList(listItem(paragraph("x")), listItem(paragraph("y"))), codeBlock("code")))',
      },
      {
        name: 'a lazy line',
        given: '[^1]: line1\nlazy',
        doc: 'doc(footnoteDefinition(paragraph("line1\\nlazy")))',
      },
      {
        name: 'in a quote',
        given: '> a[^1]\n>\n> [^1]: 引用の中',
        doc: 'doc(blockquote(paragraph("a", footnoteReference), footnoteDefinition(paragraph("引用の中"))))',
      },
      {
        name: 'in a list item',
        given: '- a[^1]\n\n  [^1]: 項目の中',
        doc: 'doc(bulletList(listItem(paragraph("a", footnoteReference), footnoteDefinition(paragraph("項目の中")))))',
      },
      {
        name: 'one interrupting a paragraph is more of its lines',
        given: 'a[^1]\ntext\n[^1]: def',
        doc: 'doc(paragraph("a", footnoteReference, "\\ntext\\n", rawInline("[^1]: def")))',
      },
      {
        name: 'one right after another is a definition of its own',
        given: '本文[^1]と[^2]。\n\n[^1]: 注一\n[^2]: 注二',
        doc: 'doc(paragraph("本文", footnoteReference, "と", footnoteReference, "。"), footnoteDefinition(paragraph("注一")), footnoteDefinition(paragraph("注二")))',
      },
      {
        name: 'one right after another’s list',
        given: '[^1]:\n    - x\n[^2]: two',
        doc: 'doc(footnoteDefinition(bulletList(listItem(paragraph("x")))), footnoteDefinition(paragraph("two")))',
      },
      {
        name: 'one right after another in a quote',
        given: '> [^1]: one\n[^2]: two',
        doc: 'doc(blockquote(footnoteDefinition(paragraph("one"))), footnoteDefinition(paragraph("two")))',
      },
      {
        name: 'one indented into another is more of its lines',
        given: '[^1]: one\n    [^2]: two',
        doc: 'doc(footnoteDefinition(paragraph("one\\n", rawInline("[^2]: two"))))',
      },
      {
        name: 'editing one right before another',
        given: '本文[^1]と[^2]。\n\n[^1]: ‸注一\n[^2]: 注二',
        steps: ['X'],
        expect: '本文[^1]と[^2]。\n\n[^1]: X‸注一\n[^2]: 注二',
      },
      {
        name: 'one of paragraphs interrupting a paragraph is kept as written',
        given: 'a\n[^1]: x\n\n    b',
        doc: 'doc(paragraph("a"), rawBlock("[^1]: x\\n\\n    b"))',
      },
      {
        name: 'inline syntax in it',
        given: '[^1]: *強調* $x$ {漢字|かんじ}^[注の注]',
        doc: 'doc(footnoteDefinition(paragraph(italic("強調"), " ", math, " ", ruby("漢字"), inlineFootnote("注の注"))))',
      },
      {
        name: 'two with one label',
        given: 'a[^1]\n\n[^1]: def\n\n[^1]: dup',
      },
      {
        name: 'editing one',
        given: '[^1]: 注の‸\n\n    二段落目',
        steps: ['本文'],
        expect: '[^1]: 注の本文‸\n\n    二段落目',
      },
      {
        name: 'editing its second paragraph',
        given: '[^1]: 注\n\n    二段落‸',
        steps: ['目'],
        expect: '[^1]: 注\n\n    二段落目‸',
      },
      {
        name: 'a line break typed into it',
        given: '[^1]: 一行目‸',
        steps: [press('Enter'), '二'],
        expect: '[^1]: 一行目\n\n    二‸',
      },
      {
        name: 'adding a definition',
        given: '本文[^2]‸',
        steps: [
          command('add the definition', (editor) =>
            editor.commands.insertFootnoteDefinition('2', '注の本文'),
          ),
        ],
        expect: '本文[^2]\n\n[^2]: 注の本文',
      },
      {
        name: 'no second definition of a label',
        given: '本文[^1]‸\n\n[^1]: 注',
        steps: [
          refused('add another definition', (editor) =>
            editor.commands.insertFootnoteDefinition('1', 'x'),
          ),
        ],
        expect: '本文[^1]\n\n[^1]: 注',
      },
      {
        name: 'relabelling a definition',
        given: '[^1]: 注‸',
        steps: [
          command('relabel the definition', (editor) =>
            editor.commands.setFootnoteDefinitionLabel('a'),
          ),
        ],
        expect: '[^a]: 注',
      },
      {
        // A list item has to start with a paragraph.
        name: 'typed as the first paragraph of a list item, it stays text',
        given: '- ‸',
        steps: ['[^1]: 項目の注'],
        expect: '- \\[^1]: 項目の注‸',
        doc: 'doc(bulletList(listItem(paragraph("[^1]: 項目の注"))))',
      },
      {
        name: 'a pasted definition',
        given: '‸',
        steps: [paste('[^1]: 貼り付けた注')],
        expect: '[^1]: 貼り付けた注‸',
        doc: 'doc(footnoteDefinition(paragraph("貼り付けた注")))',
      },
      {
        name: 'typed in a document recorded before them, it stays text',
        given: '本文[^1]‸',
        steps: [recordInlineEra, press('Enter'), '[^1]: 注の本文'],
        expect: '本文[^1]\n\n\\[^1]: 注の本文‸',
        doc: 'doc(paragraph("本文", footnoteReference), paragraph("[^1]: 注の本文"))',
      },
      {
        name: 'no definition is added to a document made with marked',
        given: '本文‸',
        steps: [
          recordMarked,
          refused('add a definition', (editor) =>
            editor.commands.insertFootnoteDefinition('1'),
          ),
        ],
        expect: '本文',
      },
    ],
  },
  {
    title: 'VFM table of contents',
    cases: [
      { name: 'a table of contents', given: '# A\n\n[[toc]]\n\n## B' },
      { name: 'it is a node', given: '[[toc]]', doc: 'doc(tableOfContents)' },
      {
        name: 'in a quote',
        given: '> [[toc]]',
        doc: 'doc(blockquote(tableOfContents))',
      },
      {
        name: 'with spaces and attributes',
        given: '[[ toc a=1 ]]',
        doc: 'doc(tableOfContents)',
      },
      {
        name: 'other shortcodes, which VFM removes, are kept as written',
        given: '[[TOC]]\n\n[[foo bar=1]]',
        doc: 'doc(rawBlock("[[TOC]]"), rawBlock("[[foo bar=1]]"))',
      },
      {
        name: 'after text it is text',
        given: 'text [[toc]]',
        doc: 'doc(paragraph("text [[toc]]"))',
      },
      {
        name: 'indented it is text',
        given: '  [[toc]]',
        doc: 'doc(paragraph("[[toc]]"))',
      },
      {
        name: 'it cannot interrupt a paragraph',
        given: 'text\n[[toc]]',
        doc: 'doc(paragraph("text\\n[[toc]]"))',
      },
      {
        name: 'escaped it is text',
        given: '\\[[toc]]',
        doc: 'doc(paragraph("[[toc]]"))',
      },
      {
        name: 'text after it on its line',
        given: '[[toc]] text',
        doc: 'doc(tableOfContents, paragraph(" text"))',
        fails: SHORTCODE_TEXT,
      },
      {
        name: 'typed alone in a paragraph',
        given: '‸',
        steps: ['[[toc]]', 'x'],
        expect: '[[toc]]\n\nx‸',
        doc: 'doc(tableOfContents, paragraph("x"))',
      },
      {
        name: 'inserted',
        given: '# A‸',
        steps: [
          command('insert a table of contents', (editor) =>
            editor.commands.insertTableOfContents(),
          ),
        ],
        expect: '# A\n\n[[toc]]',
      },
      {
        name: 'text inserted as one is escaped',
        given: '‸',
        steps: [insert('[[toc]]')],
        expect: '\\[[toc]\\]',
      },
      {
        // To the document's definitions it is text, which needs no escape.
        name: 'typed in a document recorded before it, it stays text',
        given: '‸',
        steps: [recordInlineEra, '[[toc]]'],
        expect: '[[toc]]‸',
        doc: 'doc(paragraph("[[toc]]"))',
      },
    ],
  },
  {
    title: 'GFM task lists',
    cases: [
      { name: 'tasks', given: '- [ ] task\n- [x] done' },
      {
        name: 'a task is a list item with a checkbox',
        given: '- [ ] task\n- [x] done\n- item',
        json: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'task' }],
                  },
                ],
              },
              { type: 'listItem', attrs: { checked: true } },
              { type: 'listItem', attrs: { checked: null } },
            ],
          },
        ],
      },
      { name: 'an upper-case x', given: '- [X] up' },
      {
        name: 'an empty task',
        given: '- [ ] \n- b',
        json: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph' }],
              },
              { type: 'listItem', attrs: { checked: null } },
            ],
          },
        ],
      },
      {
        name: 'no space after the checkbox is no task',
        given: '- [ ]',
        doc: 'doc(bulletList(listItem(paragraph("[ ]"))))',
      },
      { name: 'an ordered list', given: '1. [ ] a\n2. [x] b' },
      { name: 'more paragraphs', given: '- [ ] a\n\n  para' },
      { name: 'nested', given: '- [ ] a\n  - [x] b' },
      {
        name: 'an escaped checkbox is text',
        given: '- \\[ ] esc',
        json: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', attrs: { checked: null } }],
          },
        ],
      },
      {
        name: 'a quote after the checkbox',
        given: '- [ ] > q',
        doc: 'doc(bulletList(listItem(paragraph, blockquote(paragraph("q")))))',
        fails:
          'VFM 2 reads a block after the checkbox; micromark reads the rest of the line as text',
      },
      {
        name: 'checking a task',
        given: '- [ ] ta‸sk',
        steps: [
          command('check it', (editor) => editor.commands.setTaskItem(true)),
        ],
        expect: '- [x] ta‸sk',
      },
      {
        name: 'checking keeps an upper-case x when unchecking and checking',
        given: '- [X] ta‸sk',
        steps: [
          command('uncheck it', (editor) => editor.commands.setTaskItem(false)),
        ],
        expect: '- [ ] ta‸sk',
      },
      {
        name: 'making a task of an item',
        given: '- ite‸m',
        steps: [
          command('make a task', (editor) =>
            editor.commands.setTaskItem(false),
          ),
        ],
        expect: '- [ ] ite‸m',
      },
      {
        name: 'making an item of a task',
        given: '- [x] ite‸m',
        steps: [
          command('make an item', (editor) =>
            editor.commands.setTaskItem(null),
          ),
        ],
        expect: '- ite‸m',
      },
      {
        name: 'typing a checkbox at the start of an item',
        given: '- ‸',
        steps: ['[ ] やること'],
        expect: '- [ ] やること‸',
        json: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', attrs: { checked: false } }],
          },
        ],
      },
      {
        name: 'a new item after a task is a task to do',
        given: '- [x] 済み‸',
        steps: [press('Enter'), '次'],
        expect: '- [x] 済み\n- [ ] 次‸',
      },
      {
        name: 'text like a checkbox in an item is escaped',
        given: '- ‸',
        steps: [insert('[ ] not a task')],
        expect: '- \\[ \\] not a task‸',
      },
      {
        name: 'typed in a document recorded before them, it stays text',
        given: '- ‸',
        steps: [recordInlineEra, '[ ] x'],
        expect: '- \\[ \\] x‸',
        doc: 'doc(bulletList(listItem(paragraph("[ ] x"))))',
      },
    ],
  },
  {
    title: 'VFM figures and images',
    cases: [
      { name: 'a figure', given: '![キャプション](fig.png)' },
      {
        name: 'a figure is an image block',
        given: '![cap](a.png "t")',
        json: [
          {
            type: 'image',
            attrs: { src: 'a.png', alt: 'cap', title: 't' },
          },
        ],
      },
      {
        name: 'the caption as written',
        given: '![cap *em* `c`](a.png)',
        json: [{ type: 'image', attrs: { alt: 'cap *em* `c`' } }],
      },
      {
        name: 'escapes and references in the caption are read',
        given: '![a\\]b &amp; c](a.png)',
        json: [{ type: 'image', attrs: { alt: 'a]b & c' } }],
      },
      {
        name: 'brackets in the caption',
        given: '![図 [1] の説明](a.png)',
        json: [{ type: 'image', attrs: { alt: '図 [1] の説明' } }],
      },
      { name: 'no caption', given: '![](a.png)', doc: 'doc(image)' },
      {
        name: 'attributes',
        given: '![cap](a.png){width=100 #i .c}',
        json: [
          {
            type: 'image',
            attrs: { attributes: { id: 'i', class: 'c', width: '100' } },
          },
        ],
      },
      {
        name: 'in a quote',
        given: '> ![cap](a.png)',
        doc: 'doc(blockquote(image))',
      },
      {
        name: 'in a list item',
        given: '- ![cap](a.png)',
        doc: 'doc(bulletList(listItem(paragraph, image)))',
      },
      {
        name: 'an image in text',
        given: 'text ![cap](a.png) more',
        doc: 'doc(paragraph("text ", inlineImage, " more"))',
        json: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'text ' },
              { type: 'inlineImage', attrs: { src: 'a.png', alt: 'cap' } },
              { type: 'text', text: ' more' },
            ],
          },
        ],
      },
      {
        name: 'an image in a link',
        given: '[![cap](a.png)](u)',
        json: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'inlineImage',
                marks: [{ type: 'link', attrs: { href: 'u' } }],
              },
            ],
          },
        ],
      },
      {
        name: 'two images in a paragraph',
        given: '![a](a.png)![b](b.png)\n![c](c.png)',
        doc: 'doc(paragraph(inlineImage, inlineImage, "\\n", inlineImage))',
      },
      {
        name: 'an image in emphasis',
        given: '*![cap](a.png)*',
        doc: 'doc(paragraph(italic(inlineImage)))',
      },
      {
        name: 'an image in text with attributes',
        given: '本文 ![a](b.png){.c} 続き',
        json: [
          {
            type: 'paragraph',
            content: [
              { type: 'text' },
              { type: 'inlineImage', attrs: { attributes: { class: 'c' } } },
              { type: 'text' },
            ],
          },
        ],
      },
      {
        name: 'an image in a heading',
        given: '# ![icon](i.png) 見出し',
        doc: 'doc(heading(inlineImage, " 見出し"))',
      },
      {
        name: 'changing the caption',
        given: '![旧](a.png)\n\n本文‸',
        steps: [
          selectNode('image'),
          run('change the caption', (editor) => {
            editor.commands.updateAttributes('image', {
              alt: '新しい [図] \\',
            });
          }),
        ],
        expect: '![新しい \\[図\\] \\\\](a.png)\n\n本文',
      },
      {
        name: 'emptying the caption',
        given: '![旧](a.png){#fig}\n\n本文‸',
        steps: [
          selectNode('image'),
          run('empty the caption', (editor) => {
            editor.commands.updateAttributes('image', { alt: '' });
          }),
        ],
        expect: '![](a.png){#fig}\n\n本文',
      },
      {
        name: 'emptying the alt text of an image in text',
        given: 'a ![旧](a.png) b‸',
        steps: [
          selectNode('inlineImage'),
          run('empty the alt text', (editor) => {
            editor.commands.updateAttributes('inlineImage', { alt: '' });
          }),
        ],
        expect: 'a ![](a.png) b',
      },
      {
        name: 'changing the caption keeps the attributes',
        given: '![旧](a.png){#fig}\n\n本文‸',
        steps: [
          selectNode('image'),
          run('change the caption', (editor) => {
            editor.commands.updateAttributes('image', { alt: '新' });
          }),
        ],
        expect: '![新](a.png){#fig}\n\n本文',
      },
      {
        name: 'typing an image in text',
        given: 'これは‸',
        steps: [' ![a](b.png) です'],
        expect: 'これは ![a](b.png) です‸',
        doc: 'doc(paragraph("これは ", inlineImage, " です"))',
      },
      {
        name: 'an image typed alone is a figure',
        given: '‸',
        steps: ['![図](a.png)'],
        expect: '![図](a.png)',
        doc: 'doc(image)',
      },
      {
        name: 'the text around an image deleted',
        given: '‸前 ‸![a](b.png)',
        steps: [press('Backspace')],
        expect: '![a](b.png)',
        doc: 'doc(image)',
      },
      {
        name: 'a pasted image in text',
        given: '本文‸',
        steps: [paste('と ![図](a.png) と')],
        expect: '本文と ![図](a.png) と‸',
        doc: 'doc(paragraph("本文と ", inlineImage, " と"))',
      },
      {
        name: 'code over an image leaves it out',
        given: '‸a ![i](i.png) b‸',
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
        expect: '‸`a `![i](i.png)` b`‸',
      },
      {
        name: 'an image typed into text recorded before images in text',
        given: 'これは‸',
        steps: [recordInlineEra, ' ![a](b.png)'],
        expect: 'これは&#x20;\n\n![a](b.png)',
        doc: 'doc(paragraph("これは "), image)',
      },
    ],
  },
  {
    title: 'VFM code captions',
    cases: [
      {
        name: 'a caption after the language',
        given: '```js:app.js\nconst a = 1;\n```',
        json: [{ type: 'codeBlock', attrs: { language: 'js:app.js' } }],
      },
      { name: 'a title', given: '```js title="my app.js"\nx\n```' },
      { name: 'attributes', given: '```js title=a {#cid .cc}\nx\n```' },
      { name: 'Japanese caption', given: '```py:例.py\nprint(1)\n```' },
      {
        name: 'changing the caption after the language',
        given: '```js:app.js\nx‸\n```',
        steps: [
          command('change the caption', (editor) =>
            editor.commands.setCodeBlockCaption('main.js'),
          ),
        ],
        expect: '```js:main.js\nx‸\n```',
      },
      {
        name: 'changing the title keeps its form',
        given: '```js title="my app.js" {#c}\nx‸\n```',
        steps: [
          command('change the caption', (editor) =>
            editor.commands.setCodeBlockCaption('新しい 名前'),
          ),
        ],
        expect: '```js title="新しい 名前" {#c}\nx‸\n```',
      },
      {
        name: 'adding a caption',
        given: '```js\nx‸\n```',
        steps: [
          command('add a caption', (editor) =>
            editor.commands.setCodeBlockCaption('例'),
          ),
        ],
        expect: '```js title=例\nx‸\n```',
      },
      {
        name: 'adding a caption with spaces',
        given: '```\nx‸\n```',
        steps: [
          command('add a caption', (editor) =>
            editor.commands.setCodeBlockCaption('a b'),
          ),
        ],
        expect: '```text title="a b"\nx‸\n```',
      },
      {
        name: 'taking the caption away',
        given: '```js:app.js\nx‸\n```',
        steps: [
          command('take the caption away', (editor) =>
            editor.commands.setCodeBlockCaption(''),
          ),
        ],
        expect: '```js\nx‸\n```',
      },
      {
        name: 'no caption with a quotation mark',
        given: '```js\nx‸\n```',
        steps: [
          refused('add the caption', (editor) =>
            editor.commands.setCodeBlockCaption('a"b'),
          ),
        ],
        expect: '```js\nx‸\n```',
      },
      {
        name: 'editing the code keeps the info string',
        given: '```js  title="a"   {#c}\nx‸\n```',
        steps: ['y'],
        expect: '```js  title="a"   {#c}\nxy‸\n```',
      },
      {
        name: 'typing the fence with a caption',
        given: '‸',
        steps: ['```js:app.js', press('Enter'), 'x'],
        expect: '```js:app.js\nx‸\n```',
      },
    ],
  },
  {
    title: 'block VFM pasted into a document recorded before it',
    cases: [
      {
        name: 'a table of contents is its markdown as text',
        given: 'a‸',
        steps: [
          recordInlineEra,
          run('paste a table of contents', (editor) => {
            editor.commands.insertContent({ type: 'tableOfContents' });
          }),
        ],
        expect: 'a\n\n[[toc]]',
        doc: 'doc(paragraph("a"), paragraph("[[toc]]"))',
      },
      {
        name: 'a definition is its content',
        given: 'a‸',
        steps: [
          recordInlineEra,
          run('paste a definition', (editor) => {
            editor.commands.insertContent({
              type: 'footnoteDefinition',
              attrs: { label: '1' },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: '注' }] },
              ],
            });
          }),
        ],
        expect: 'a\n\n注',
      },
      {
        name: 'a line that ends a section is hashes as text',
        given: 'a‸',
        steps: [
          recordInlineEra,
          run('paste a section end', (editor) => {
            editor.commands.insertContent({
              type: 'sectionEnd',
              attrs: { level: 2 },
            });
          }),
        ],
        expect: 'a\n\n\\#\\#',
      },
      {
        name: 'a heading loses its attributes',
        given: 'a‸',
        steps: [
          recordInlineEra,
          run('paste a heading with attributes', (editor) => {
            editor.commands.insertContent({
              type: 'heading',
              attrs: { level: 2, attributes: { id: 'x' } },
              content: [{ type: 'text', text: 'H' }],
            });
          }),
        ],
        expect: 'a\n\n## H',
      },
      {
        name: 'a task is an item',
        given: '- a‸',
        steps: [
          recordInlineEra,
          run('make the item a task without the command', (editor) => {
            const { $from } = editor.state.selection;
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup($from.before(-1), undefined, {
                checked: true,
              }),
            );
          }),
        ],
        expect: '- a',
      },
      {
        name: 'an image in text is its markdown as text',
        given: 'a ‸b',
        steps: [
          recordInlineEra,
          run('paste an image in text', (editor) => {
            editor.commands.insertContent({
              type: 'inlineImage',
              attrs: { src: 'i.png', alt: 'i' },
            });
          }),
        ],
        expect: 'a !\\[i](i.png\\)‸b',
      },
    ],
  },
  {
    title: 'block VFM in a document made with marked',
    cases: [
      {
        name: 'typed syntax stays text',
        given: '‸',
        steps: [recordMarked, '[[toc]]'],
        expect: '[[toc]]‸',
        doc: 'doc(paragraph("[[toc]]"))',
      },
      {
        name: 'commands do nothing',
        given: '- a‸',
        steps: [
          recordMarked,
          refused('use a block command', (editor) =>
            [
              editor.commands.insertTableOfContents(),
              editor.commands.insertSectionEnd(1),
              editor.commands.setTaskItem(true),
              editor.commands.insertFootnoteDefinition('1'),
            ].some(Boolean),
          ),
        ],
        expect: '- a',
      },
    ],
  },
];
