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
    title: 'formatting of typed text',
    cases: [
      {
        name: 'inside formatting takes it',
        given: '**a‸b**',
        steps: ['c'],
        expect: '**ac‸b**',
      },
      {
        name: 'at the end of formatting does not take it',
        given: '**a**‸b',
        steps: ['c'],
        expect: '**a**c‸b',
      },
      {
        name: 'at the end of formatting that ends the line does not take it',
        given: '**a**‸',
        steps: ['c'],
        expect: '**a**c‸',
      },
      {
        name: 'at the start of formatting that starts the line does not take it',
        given: '‸**a**',
        steps: ['c'],
        expect: 'c‸**a**',
      },
      {
        name: 'between two kinds of formatting takes neither',
        given: '**a**‸*b*',
        steps: ['c'],
        expect: '**a**c‸*b*',
      },
      {
        name: 'at the end of a link does not join it',
        given: '[a](u)‸',
        steps: ['c'],
        expect: '[a](u)c‸',
      },
      {
        name: 'at the end of inline code does not join it',
        given: '`a`‸',
        steps: ['c'],
        expect: '`a`c‸',
      },
      {
        name: 'at the end of strikethrough does not take it',
        given: '~~a~~‸',
        steps: ['c'],
        expect: '~~a~~c‸',
      },
      {
        name: 'over a selection that ends formatting does not take it',
        given: '**a‸b**‸c',
        steps: ['X'],
        expect: '**a**X‸c',
      },
      {
        name: 'after Backspace at the end of formatting does not take it',
        given: '**ab**‸',
        steps: [press('Backspace'), 'c'],
        expect: '**a**c‸',
      },
      {
        name: 'after Backspace of plain text after formatting does not take it',
        given: '**a**b‸',
        steps: [press('Backspace'), 'c'],
        expect: '**a**c‸',
      },
      {
        name: 'after Backspace of plain text inside formatting takes it',
        given: '**a**b‸**c**',
        steps: [press('Backspace'), 'd'],
        expect: '**ad‸c**',
      },
      {
        name: 'after Delete at the start of formatting does not take it',
        given: 'a‸**bc**',
        steps: [press('Delete'), 'd'],
        expect: 'ad‸**c**',
      },
      {
        name: 'after Mod-b at the end of formatting takes it',
        given: '**a**‸',
        steps: [press('Mod-b'), 'cd'],
        expect: '**acd**‸',
      },
      {
        name: 'after Mod-b inside formatting does not take it',
        given: '**a‸b**',
        steps: [press('Mod-b'), 'cd'],
        expect: '**a**cd‸**b**',
      },
    ],
  },
  {
    title: 'typing a URL',
    cases: [
      {
        name: 'becomes a link once markdown reads it as one',
        given: 'a ‸ b',
        steps: ['https://example.com'],
        expect: 'a https://example.com b',
        doc: 'doc(paragraph("a ", link("https://example.com"), " b"))',
      },
      {
        name: 'its link takes in what is typed after it',
        given: 'a ‸ b',
        steps: ['https://example.com/path?q=1'],
        expect: 'a https://example.com/path?q=1 b',
        doc: 'doc(paragraph("a ", link("https://example.com/path?q=1"), " b"))',
      },
      {
        name: 'punctuation typed after it stays out of its link',
        given: 'a ‸ b',
        steps: ['https://example.com.'],
        expect: 'a https://example.com. b',
        doc: 'doc(paragraph("a ", link("https://example.com"), ". b"))',
      },
      {
        name: 'a www address becomes a link',
        given: 'a ‸ b',
        steps: ['www.example.com'],
        expect: 'a www.example.com b',
        doc: 'doc(paragraph("a ", link("www.example.com"), " b"))',
      },
      {
        name: 'an email address becomes a link',
        given: 'a ‸ b',
        steps: ['user@example.com'],
        expect: 'a user@example.com b',
        doc: 'doc(paragraph("a ", link("user@example.com"), " b"))',
      },
      {
        name: 'a domain that markdown does not link stays text',
        given: 'a ‸ b',
        steps: ['example.com'],
        expect: 'a example.com‸ b',
        doc: 'doc(paragraph("a example.com b"))',
      },
      {
        name: 'in inline code stays text',
        given: 'a `x‸y`',
        steps: ['https://example.com'],
        expect: 'a `xhttps://example.com‸y`',
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
    ],
  },
];
