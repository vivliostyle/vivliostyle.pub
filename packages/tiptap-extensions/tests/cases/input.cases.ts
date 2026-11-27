import { press, run } from '../../testing/steps';
import type { CaseSuite } from '../../testing/vitest';

export const inputSuites: CaseSuite[] = [
  {
    title: 'typing text',
    cases: [
      { name: 'at the caret', given: 'ab‸cd', steps: ['X'], expect: 'abX‸cd' },
      {
        name: 'over a selection',
        given: 'a‸bc‸d',
        steps: ['X'],
        expect: 'aX‸d',
      },
      {
        name: 'into an empty document',
        given: '‸',
        steps: ['hello'],
        expect: 'hello‸',
      },
      {
        name: 'Enter splits a paragraph',
        given: 'ab‸cd',
        steps: [press('Enter')],
        expect: 'ab\n\n‸cd',
      },
      {
        name: 'Backspace removes a character',
        given: 'abc‸',
        steps: [press('Backspace')],
        expect: 'ab‸',
      },
      {
        name: 'Backspace joins paragraphs',
        given: 'ab\n\n‸cd',
        steps: [press('Backspace')],
        expect: 'ab‸cd',
      },
    ],
  },
  {
    title: 'markdown shortcuts',
    cases: [
      { name: 'heading', given: '‸', steps: ['## Title'], expect: '## Title‸' },
      { name: 'bullet list', given: '‸', steps: ['- item'], expect: '- item‸' },
      {
        name: 'ordered list',
        given: '‸',
        steps: ['1. item'],
        expect: '1. item‸',
      },
      {
        name: 'blockquote',
        given: '‸',
        steps: ['> quote'],
        expect: '> quote‸',
      },
      { name: 'bold', given: '‸', steps: ['a **b** c'], expect: 'a **b** c‸' },
      {
        name: 'inline code',
        given: '‸',
        steps: ['a `b` c'],
        expect: 'a `b` c‸',
      },
      {
        name: 'fence line and Enter open a code block',
        given: '‸',
        steps: ['```js title=a.js', press('Enter'), 'x'],
        expect: '```js title=a.js\nx‸\n```',
        doc: 'doc(codeBlock("x"))',
      },
      {
        name: 'Mod-b toggles bold',
        given: 'a ‸b‸ c',
        steps: [press('Mod-b')],
        expect: 'a ‸**b**‸ c',
      },
      {
        name: 'Mod-Shift-s toggles strikethrough',
        given: 'a ‸b‸ c',
        steps: [press('Mod-Shift-s')],
        expect: 'a ‸~~b~~‸ c',
      },
      {
        name: 'Mod-Shift-b wraps a blockquote',
        given: 'a‸',
        steps: [press('Mod-Shift-b')],
        expect: '> a‸',
      },
    ],
  },
  {
    title: 'lists',
    cases: [
      {
        name: 'Enter adds an item',
        given: '- a‸',
        steps: [press('Enter'), 'b'],
        expect: '- a\n- b‸',
      },
      {
        name: 'Enter on an empty item leaves the list',
        given: '- a\n- ‸',
        steps: [press('Enter'), 'b'],
        expect: '- a\n\nb‸',
      },
      {
        name: 'Tab nests an item',
        given: '- a\n- b‸',
        steps: [press('Tab')],
        expect: '- a\n  - b‸',
      },
      {
        name: 'Shift-Tab lifts an item',
        given: '- a\n  - b‸',
        steps: [press('Shift-Tab')],
        expect: '- a\n- b‸',
      },
      {
        name: 'Enter on a selection from a paragraph into a list item',
        given: '‸a\n- b‸',
        steps: [press('Enter')],
        expect: '',
        fails:
          'splitBlock decides whether it can split on the document before deleting the selection, and the split fails once the deletion has changed the structure',
      },
    ],
  },
  {
    title: 'saving after an edit',
    cases: [
      {
        name: 'keeps how the other blocks are written',
        given: '* a\n* b\n\n\nSetext\n===\n\n_c_ d‸',
        steps: ['e'],
        expect: '* a\n* b\n\n\nSetext\n===\n\n_c_ de‸',
      },
      {
        name: 'writes the edited block in the style the document uses',
        given: '_a_ and _b_\n\n__c__ d‸',
        steps: [' ', press('Mod-i'), 'e'],
        expect: '_a_ and _b_\n\n__c__ d _e_‸',
      },
      {
        name: 'falls back to the other emphasis mark inside a word',
        given: '_a_ and _b_\n\nc‸',
        steps: [press('Mod-i'), 'd'],
        expect: '_a_ and _b_\n\nc*d*‸',
      },
      {
        name: 'keeps raw HTML in the edited block',
        given: 'a <span class="x">b</span> c‸',
        steps: ['d'],
        expect: 'a <span class="x">b</span> cd‸',
      },
      {
        name: 'keeps a footnote reference in the edited block',
        given: 'a[^1] b‸\n\n[^1]: note',
        steps: ['c'],
        expect: 'a[^1] bc‸\n\n[^1]: note',
      },
      {
        name: 'escapes typed text that would read as syntax',
        given: '‸',
        steps: [
          run('insert text without input rules', (editor) => {
            editor.view.dispatch(editor.state.tr.insertText('1. *not* a list'));
          }),
        ],
        expect: '1\\. \\*not\\* a list‸',
      },
      {
        name: 'joining paragraphs keeps the soft line breaks',
        given: 'a\nb‸',
        steps: [press('Enter'), press('Backspace')],
        expect: 'a\nb‸',
        fails:
          "ProseMirror's join converts the newlines of a joined textblock into the schema's linebreak replacement, so soft breaks become hard breaks",
      },
      {
        name: 'deleting the text of emphasis around a line break',
        given: 't *a‸\nb*',
        steps: [
          press('Backspace'),
          run('select b', (editor) => {
            let from: number | undefined;
            editor.state.doc.descendants((node, pos) => {
              const index = node.isText ? (node.text ?? '').indexOf('b') : -1;
              if (from === undefined && index !== -1) {
                from = pos + index;
              }
            });
            if (from === undefined) {
              throw new Error('No text holds b');
            }
            editor.commands.setTextSelection({ from, to: from + 1 });
          }),
          press('Backspace'),
        ],
        expect: 't ',
        fails:
          'Emphasis of a newline alone is not treated as whitespace at the edges of emphasis that markdown cannot hold: the save is refused',
      },
    ],
  },
];
