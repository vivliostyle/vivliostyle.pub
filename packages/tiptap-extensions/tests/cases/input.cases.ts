import { press } from '../../testing/steps';
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
      },
      {
        name: 'ruby becomes a node as it is closed',
        given: '‸',
        steps: ['{漢字|かんじ}'],
        expect: '{漢字|かんじ}‸',
        doc: 'doc(paragraph(ruby("漢字")))',
        fails: 'there is no ruby node',
      },
    ],
  },
];
