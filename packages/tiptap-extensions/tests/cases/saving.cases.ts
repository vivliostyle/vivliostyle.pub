import type { Editor } from '@tiptap/core';

import { saveMarkdown } from '../../testing/editor-io';
import { press, run, type Step } from '../../testing/steps';
import type { CaseSuite } from '../../testing/vitest';

/** Inserts text at the selection as a paste would, without input rules. */
function insert(text: string): Step {
  return run(`insert ${JSON.stringify(text)}`, (editor) => {
    editor.view.dispatch(editor.state.tr.insertText(text));
  });
}

/** Inserts text after the first occurrence of `needle` in the text. */
function insertAfter(needle: string, text: string): Step {
  return run(`insert ${JSON.stringify(text)} after ${needle}`, (editor) => {
    let at: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      const index = node.isText ? (node.text ?? '').indexOf(needle) : -1;
      if (at === undefined && index !== -1) {
        at = pos + index + needle.length;
      }
    });
    if (at === undefined) {
      throw new Error(`No text holds ${needle}`);
    }
    editor.view.dispatch(editor.state.tr.insertText(text, at));
  });
}

// A caret mark in or right after a bare URL would be read as part of it.
function select(needle: string, caret: 'after' | 'all' = 'after'): Step {
  return run(`select ${caret === 'all' ? '' : 'after '}${needle}`, (editor) => {
    let from: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      const index = node.isText ? (node.text ?? '').indexOf(needle) : -1;
      if (from === undefined && index !== -1) {
        from = pos + index;
      }
    });
    if (from === undefined) {
      throw new Error(`No text holds ${needle}`);
    }
    const to = from + needle.length;
    editor.commands.setTextSelection(
      caret === 'all' ? { from, to } : { from: to, to },
    );
  });
}

function appendParagraphs(text: string, count: number): Step {
  return run(`append ${count} paragraphs`, (editor: Editor) => {
    const { schema } = editor.state;
    const tr = editor.state.tr;
    for (let i = 0; i < count; i++) {
      tr.insert(
        tr.doc.content.size,
        schema.nodes.paragraph.create(null, schema.text(text)),
      );
    }
    editor.view.dispatch(tr);
  });
}

// A caret mark at the start of a line would keep it from reading as HTML.
function selectStartOf(name: string): Step {
  return run(`select the start of the ${name}`, (editor) => {
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.type.name === name) {
        at = pos + 1;
      }
    });
    editor.commands.setTextSelection(at);
  });
}

const save = run('save', saveMarkdown);

const CJK_FLANKING =
  'CommonMark does not let `**` open after a letter and before `「`, which VFM 2.7.2 does, and the editor has no CJK-friendly emphasis yet';

export const savingSuites: CaseSuite[] = [
  {
    title: 'emphasis next to Japanese punctuation',
    cases: [
      {
        name: 'bold over a quotation',
        given: 'これは‸「重要」‸です。',
        steps: [press('Mod-b')],
        expect: 'これは<strong>「重要」</strong>です。',
      },
      {
        name: 'bold ending at a full stop',
        given: 'これは‸重要。‸次の文。',
        steps: [press('Mod-b')],
        expect: 'これは<strong>重要。</strong>次の文。',
      },
      {
        name: 'bold over brackets',
        given: '金額‸（税込）‸です',
        steps: [press('Mod-b')],
        expect: '金額<strong>（税込）</strong>です',
      },
      {
        name: 'italic over a quotation',
        given: 'これは‸「重要」‸です。',
        steps: [press('Mod-i')],
        expect: 'これは<em>「重要」</em>です。',
      },
      {
        name: 'strikethrough over a quotation',
        given: 'これは‸「重要」‸です。',
        steps: [
          run('toggle strikethrough', (editor) => {
            editor.commands.toggleStrike();
          }),
        ],
        expect: 'これは<del>「重要」</del>です。',
      },
      {
        name: 'delimiters where they flank',
        given: 'これは‸重要‸です。',
        steps: [press('Mod-b')],
        expect: 'これは**重要**です。',
      },
      {
        name: 'strong tags are bold',
        given: 'これは<strong>「重要」</strong>です。',
        doc: 'doc(paragraph("これは", bold("「重要」"), "です。"))',
      },
      {
        name: 'delimiters before a quotation are bold',
        given: 'これは**「重要」**です。',
        doc: 'doc(paragraph("これは", bold("「重要」"), "です。"))',
        fails: CJK_FLANKING,
      },
    ],
  },
  {
    title: 'text that GFM autolinks',
    cases: [
      {
        name: 'a URL typed into a heading',
        given: '# ‸第一章\n\n本文',
        steps: [insert('https://a.jp ')],
        expect: '# https://a.jp 第一章\n\n本文',
      },
      {
        name: 'an email address',
        given: '本文‸',
        steps: [insert(' user@example.com まで')],
        expect: '本文 user@example.com まで',
      },
      {
        name: 'a www address',
        given: '詳細は‸',
        steps: [insert('www.example.com を参照')],
        expect: '詳細はwww.example.com を参照',
      },
      {
        name: 'a URL typed right after a link to it',
        given: '[本文](https://a.jp)‸',
        steps: ['https://a.jp'],
        expect: '[本文](https://a.jp)https://a.jp‸',
      },
      {
        name: 'a link to its own URL is written bare once what followed it is deleted',
        given: '[https://example.com](https://example.com)x‸',
        steps: [press('Backspace')],
        expect: 'https://example.com',
      },
      {
        name: 'a link to its own URL is written bare once what follows it ends the URL',
        given: '[https://example.com](https://example.com)x‸y',
        steps: [press('Backspace'), ' '],
        expect: 'https://example.com ‸y',
      },
      {
        name: 'a link to its own URL is written bare once what preceded it is deleted',
        given: 'a‸[https://example.com](https://example.com)',
        steps: [press('Backspace')],
        expect: 'https://example.com',
      },
      {
        name: 'a link to its own URL stays a link while what follows it would go into the URL',
        given: '[https://example.com](https://example.com)x‸y',
        steps: [press('Backspace')],
        expect: '[https://example.com](https://example.com)‸y',
      },
      {
        name: 'a link to its own URL stays as written where nothing next to it changes',
        given: '[https://example.com](https://example.com)‸',
        steps: [' a'],
        expect: '[https://example.com](https://example.com) a‸',
      },
    ],
  },
  {
    title: 'editing a bare URL',
    cases: [
      {
        name: 'deleting a character of it edits its link',
        given: '本文 https://example.com です‸',
        steps: [select('https://example.com'), press('Backspace')],
        expect: '本文 https://example.co です',
      },
      {
        name: 'typing into it edits its link',
        given: '本文 https://example.com です‸',
        steps: [select('https://exa'), 'Z'],
        expect: '本文 https://exaZmple.com です',
      },
      {
        name: 'typing into its domain keeps it one link',
        given: '本文 https://example.com です‸',
        steps: [select('https://example.co'), 'X'],
        expect: '本文 https://example.coXm です',
      },
      {
        name: 'replacing part of it edits its link',
        given: '本文 https://example.com です‸',
        steps: [select('https', 'all'), 'http'],
        expect: '本文 http://example.com です',
      },
      {
        name: 'deleting a character of a www address edits its link',
        given: '本文 www.example.com です‸',
        steps: [select('www.example.com'), press('Backspace')],
        expect: '本文 www.example.co です',
      },
      {
        name: 'deleting a character of an email address edits its link',
        given: '本文 a@example.com です‸',
        steps: [select('a@example.com'), press('Backspace')],
        expect: '本文 a@example.co です',
      },
      {
        name: 'deleting the dot of its domain takes off its link',
        given: '本文 https://example.com です‸',
        steps: [select('.com', 'all'), press('Backspace')],
        expect: '本文 https://example です',
      },
      {
        name: 'editing it into text that is no URL takes off its link',
        given: '本文 https://example.com です‸',
        steps: [select('https://', 'all'), press('Backspace')],
        expect: '本文 example.com です',
      },
      {
        name: 'a link to its own URL in brackets is edited the same',
        given: '[https://example.com](https://example.com)x‸',
        steps: [select('https://example.com'), press('Backspace')],
        expect: '[https://example.co](https://example.co)x',
      },
      {
        name: 'a link with other text keeps its URL',
        given: '[本文](https://example.com)‸',
        steps: [select('本文'), press('Backspace')],
        expect: '[本](https://example.com)',
      },
    ],
  },
  {
    title: 'raw markdown that comes to start a line',
    cases: [
      {
        name: 'an image after the text before it is deleted',
        given: '‸本文‸\n![図](a.png)',
        steps: [press('Backspace')],
        expect: '![図](a.png)',
      },
      {
        name: 'an image after the image before it is deleted',
        given: '‸![a](a.png)‸\n![b](b.png)',
        steps: [press('Backspace')],
        expect: '![b](b.png)',
      },
      {
        name: 'an HTML element after the text before it is deleted',
        given: '‸本文‸\n<span class="note">\n注記\n</span>',
        steps: [press('Backspace')],
        expect: '<span class="note">\n注記\n</span>',
      },
    ],
  },
  {
    title: 'escaping only what an edit makes syntax',
    cases: [
      {
        name: 'math and ruby next to an edit',
        given: '式 $x^2$ を‸示す。{漢字|かんじ}',
        steps: [insertAfter('を示す', '（価格*1、送料*2）')],
        expect: '式 $x^2$ を示す（価格\\*1、送料\\*2）。{漢字|かんじ}',
      },
      {
        name: 'underscores typed next to math',
        given: 'a {a|b} $a_1$ c‸',
        steps: [insert(' __init__')],
        expect: 'a {a|b} $a_1$ c \\_\\_init\\_\\_',
      },
      {
        name: 'asterisks typed next to math',
        given: 'a {a|b} $a_1$ c‸',
        steps: [insert(' *1と*2')],
        expect: 'a {a|b} $a_1$ c \\*1と\\*2',
      },
      {
        name: 'many pasted paragraphs',
        given: '_a_\n\nSetext\n===\n\nsee https://example.com now‸',
        steps: [appendParagraphs('価格*N、送料*N', 10)],
        expect: `_a_\n\nSetext\n===\n\nsee https://example.com now${'\n\n価格\\*N、送料\\*N'.repeat(10)}`,
      },
      {
        name: 'an autolink, an entity and a no-break space in the edited block',
        given: '<https://example.com> &copy; a&nbsp;b c‸',
        steps: ['X'],
        expect: '<https://example.com> &copy; a&nbsp;b cX‸',
      },
      {
        name: 'a list right after the edited paragraph',
        given: '以下の通り‸：\n- 項目A',
        steps: ['X'],
        expect: '以下の通りX‸：\n- 項目A',
      },
      {
        name: 'an edited list right after a paragraph',
        given: '以下の通り：\n- 項目A‸',
        steps: ['X'],
        expect: '以下の通り：\n- 項目AX‸',
      },
    ],
  },
  {
    title: 'backslashes',
    cases: [
      {
        name: 'an escaped backslash is one backslash',
        given: 'a\\\\b c',
        doc: 'doc(paragraph("a\\\\b c"))',
      },
      {
        name: 'an escaped backslash stays escaped next to an edit',
        given: 'a\\\\b c‸',
        steps: ['d'],
        expect: 'a\\\\b cd‸',
      },
      {
        name: 'a typed backslash is escaped only before punctuation',
        given: 'a‸',
        steps: [insert(' \\alpha C:\\dir \\{x\\}')],
        expect: 'a \\alpha C:\\dir \\\\\\{x\\\\}‸',
      },
    ],
  },
  {
    title: 'line breaks at the edges of raw markdown',
    cases: [
      {
        name: 'typing on a line added at the end',
        given: '<div class="note">‸\n\ntext',
        steps: [press('Enter'), save, 'x'],
        expect: '<div class="note">\nx‸\n\ntext',
      },
      {
        name: 'in a quote',
        given: '> <div class="note">‸\n>\n> text',
        steps: [press('Enter'), save, 'x'],
        expect: '> <div class="note">\n> x‸\n>\n> text',
      },
      {
        name: 'a line added at the start and removed',
        given: 'a‸\n\n<div class="note">',
        steps: [
          selectStartOf('rawBlock'),
          press('Enter'),
          save,
          press('Backspace'),
        ],
        expect: 'a\n\n<div class="note">',
      },
    ],
  },
];
