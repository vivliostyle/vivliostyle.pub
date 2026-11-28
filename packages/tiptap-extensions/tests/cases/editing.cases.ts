import type { Editor } from '@tiptap/core';

import {
  insertLink,
  removeLinkFromSelection,
  setLinkOnSelection,
} from '../../src/operations/link';
import { run } from '../../testing/steps';
import type { CaseSuite } from '../../testing/vitest';

const command = (label: string, apply: (editor: Editor) => unknown) =>
  run(label, (editor) => {
    if (!apply(editor)) {
      throw new Error(`Could not ${label}`);
    }
  });

const toggleBold = command('toggle bold', (editor) =>
  editor.commands.toggleBold(),
);

export const editingSuites: CaseSuite[] = [
  {
    title: 'toggling marks',
    cases: [
      {
        name: 'bold',
        given: 'a ‸b‸ c',
        steps: [toggleBold],
        expect: 'a ‸**b**‸ c',
      },
      {
        name: 'bold twice takes it off',
        given: 'a ‸b‸ c',
        steps: [toggleBold, toggleBold],
        expect: 'a ‸b‸ c',
      },
      {
        name: 'italic',
        given: 'a ‸b‸ c',
        steps: [
          command('toggle italic', (editor) => editor.commands.toggleItalic()),
        ],
        expect: 'a ‸*b*‸ c',
      },
      {
        name: 'strike',
        given: 'a ‸b‸ c',
        steps: [
          command('toggle strike', (editor) => editor.commands.toggleStrike()),
        ],
        expect: 'a ‸~~b~~‸ c',
      },
      {
        name: 'code',
        given: 'a ‸b‸ c',
        steps: [
          command('toggle code', (editor) => editor.commands.toggleCode()),
        ],
        expect: 'a ‸`b`‸ c',
      },
    ],
  },
  {
    title: 'links on the selection',
    cases: [
      {
        name: 'linking the selection',
        given: 'a ‸b‸ c',
        steps: [
          command('link the selection', (editor) =>
            setLinkOnSelection(editor, { href: 'https://example.com' }),
          ),
        ],
        expect: 'a ‸[b](https://example.com)‸ c',
      },
      {
        name: 'linking the selection as other text',
        given: 'a ‸**b**‸ c',
        steps: [
          command('link the selection', (editor) =>
            setLinkOnSelection(editor, { href: 'u', text: 'd' }),
          ),
        ],
        expect: 'a ‸[**d**](u)‸ c',
      },
      {
        name: 'taking the link off',
        given: 'a [‸b‸](u) c',
        steps: [
          run('take the link off', (editor) => {
            removeLinkFromSelection(editor);
          }),
        ],
        expect: 'a ‸b‸ c',
      },
      {
        name: 'inserting a link',
        given: 'a ‸b',
        steps: [
          command('insert a link', (editor) =>
            insertLink(editor, { href: 'https://example.com', text: 'b' }),
          ),
        ],
        expect: 'a [b](https://example.com)‸b',
      },
      {
        name: 'inserting a link without text',
        given: 'a‸',
        steps: [
          command('insert a link', (editor) =>
            insertLink(editor, { href: 'u' }),
          ),
        ],
        expect: 'a[u](u)‸',
      },
    ],
  },
  {
    title: 'block formats',
    cases: [
      {
        name: 'a heading',
        given: 'a ‸b‸ c',
        steps: [
          command('make a heading', (editor) =>
            editor.commands.setBlockFormat('heading-2'),
          ),
        ],
        expect: '## a ‸b‸ c',
      },
      {
        name: 'a list',
        given: 'a ‸b‸ c',
        steps: [
          command('make a list', (editor) =>
            editor.commands.setBlockFormat('bullet-list'),
          ),
        ],
        expect: '- a ‸b‸ c',
      },
      {
        name: 'a horizontal rule',
        given: '‸',
        steps: [
          command('insert a horizontal rule', (editor) =>
            editor.commands.setHorizontalRule(),
          ),
          'a',
        ],
        expect: '***\n\na‸',
      },
    ],
  },
];
