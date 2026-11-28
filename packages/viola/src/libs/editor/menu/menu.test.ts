import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { ComponentType } from 'react';

import { PubExtensions } from '@v/tiptap-extensions';
import { createNodeDriver } from '@v/tiptap-extensions/testing/node-driver';
import { run, type Step, type } from '@v/tiptap-extensions/testing/steps';
import {
  type CaseSuite,
  describeCases,
} from '@v/tiptap-extensions/testing/vitest';
import {
  getActiveTrigger,
  resolveActiveTrigger,
} from '@v/tiptap-extensions/trigger-menu';
import { AttributesPanel } from '../../../components/content-editor/panels/attributes-panel';
import {
  FootnotePanel,
  FootnoteReferencePanel,
} from '../../../components/content-editor/panels/footnote-panel';
import { LinkPanel } from '../../../components/content-editor/panels/link-panel';
import { MathPanel } from '../../../components/content-editor/panels/math-panel';
import { RubyPanel } from '../../../components/content-editor/panels/ruby-panel';
import {
  defaultEditorMenuConfig,
  filterVisibleEntries,
  flattenCommands,
  resolveMenuEntries,
} from './config';
import { createEditorMenuExtensions } from './extensions';
import { filterMenuEntries } from './filter';
import {
  type FormOutcome,
  openAttributesForm,
  openFootnoteForm,
  openFootnoteReferenceForm,
  openLinkForm,
  openMathForm,
  openRubyForm,
} from './forms';
import { getEditorMenuCommand } from './registry';
import { hasToolbarSelection } from './toolbar';
import { executeTriggerCommand } from './trigger-state';
import type { EditorMenuCommand, EditorMenuPanelProps } from './types';

// The operations the menus run are pinned down by the cases of the editor's
// package. These cover what the menus add: where a command shows, when it is
// enabled or active, and what its panel does on submit.

// What the user enters in a panel's fields before submitting it.
type FormValues = Record<string, string | boolean>;

type OpenForm = (editor: Editor) => {
  apply(values: never): FormOutcome<string>;
};

const FORMS = new Map<ComponentType<EditorMenuPanelProps>, OpenForm>([
  [RubyPanel, openRubyForm],
  [MathPanel, openMathForm],
  [FootnotePanel, openFootnoteForm],
  [FootnoteReferencePanel, openFootnoteReferenceForm],
  [LinkPanel, openLinkForm],
  [AttributesPanel, openAttributesForm],
]);

function command(id: string): EditorMenuCommand {
  const found = getEditorMenuCommand(id);
  if (!found) {
    throw new Error(`${id} is not registered`);
  }
  return found;
}

function toolbarCommands(editor: Editor): EditorMenuCommand[] {
  if (!hasToolbarSelection(editor.state)) {
    return [];
  }
  const entries = resolveMenuEntries(
    defaultEditorMenuConfig.selection.items,
    'selection',
  );
  return flattenCommands(filterVisibleEntries(entries, editor));
}

function submitPanel(
  editor: Editor,
  panel: ComponentType<EditorMenuPanelProps>,
  values: FormValues | undefined,
): void {
  const open = FORMS.get(panel);
  if (!open) {
    throw new Error(`No form is known for ${panel.name}`);
  }
  if (!values) {
    throw new Error(`${panel.name} opens, but the step gives no values`);
  }
  const outcome = open(editor).apply(values as never);
  if (outcome !== 'applied') {
    throw new Error(`${panel.name} did not apply: ${JSON.stringify(outcome)}`);
  }
}

/**
 * Clicks a button of the selection toolbar, and submits the panel it opens
 * with `values`. The toolbar has to show the button enabled.
 */
function toolbar(id: string, values?: FormValues): Step {
  return run(`click ${id} in the toolbar`, (editor) => {
    const clicked = command(id);
    if (!toolbarCommands(editor).includes(clicked)) {
      throw new Error(`The toolbar shows no ${id}`);
    }
    if (!(clicked.isEnabled?.(editor) ?? true)) {
      throw new Error(`${id} is disabled in the toolbar`);
    }
    if (clicked.panel) {
      submitPanel(editor, clicked.panel, values);
    } else {
      clicked.run?.({ editor, surface: 'selection' });
    }
  });
}

/** How the toolbar shows a button: left out, disabled, or on or off. */
function toolbarShows(
  id: string,
  expected: 'hidden' | 'disabled' | 'active' | 'inactive',
): Step {
  return run(`see ${id} ${expected} in the toolbar`, (editor) => {
    const shown = command(id);
    const actual = !toolbarCommands(editor).includes(shown)
      ? 'hidden'
      : !(shown.isEnabled?.(editor) ?? true)
        ? 'disabled'
        : shown.isActive?.(editor)
          ? 'active'
          : 'inactive';
    if (actual !== expected) {
      throw new Error(`${id} is ${actual}`);
    }
  });
}

/** The commands the open trigger menu lists for what is typed after it. */
function listedCommands(editor: Editor): EditorMenuCommand[] | null {
  const active = getActiveTrigger(editor.state);
  const resolved =
    active &&
    resolveActiveTrigger(active, editor.state.doc, editor.state.selection);
  const menu = defaultEditorMenuConfig.triggers.find(
    (it) => it.id === active?.menuId,
  );
  if (!resolved || !menu) {
    return null;
  }
  return flattenCommands(
    filterMenuEntries(
      resolveMenuEntries(menu.items, 'trigger'),
      resolved.query,
    ),
  );
}

/**
 * Types a trigger menu's character and a query, then picks the command from
 * the menu, and submits the panel it opens with `values`.
 */
function trigger(chars: string, id: string, values?: FormValues): [Step, Step] {
  return [
    type(chars),
    run(`pick ${id} from the menu`, (editor) => {
      const listed = listedCommands(editor);
      if (!listed) {
        throw new Error('No menu opened');
      }
      const picked = command(id);
      if (!listed.includes(picked)) {
        throw new Error(`The menu lists no ${id}`);
      }
      const panel = executeTriggerCommand(editor, picked);
      if (panel === false) {
        throw new Error(`${id} does not apply here`);
      }
      if (panel) {
        submitPanel(editor, panel, values);
      }
    }),
  ];
}

const slash = (query: string, id: string, values?: FormValues) =>
  trigger(`/${query}`, id, values);

const selectNode = (name: string) =>
  run(`select the ${name} as a node`, (editor) => {
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (pos === -1 && node.type.name === name) {
        pos = at;
      }
      return pos === -1;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
    );
  });

const suites: CaseSuite[] = [
  {
    title: 'marks from the toolbar',
    cases: [
      {
        name: 'bold',
        given: 'a ‸b‸ c',
        steps: [toolbar('format.bold'), toolbarShows('format.bold', 'active')],
        expect: 'a ‸**b**‸ c',
      },
      {
        name: 'italic',
        given: 'a ‸b‸ c',
        steps: [
          toolbar('format.italic'),
          toolbarShows('format.italic', 'active'),
        ],
        expect: 'a ‸*b*‸ c',
      },
      {
        name: 'strike',
        given: 'a ‸b‸ c',
        steps: [
          toolbar('format.strike'),
          toolbarShows('format.strike', 'active'),
        ],
        expect: 'a ‸~~b~~‸ c',
      },
      {
        name: 'code',
        given: 'a ‸b‸ c',
        steps: [toolbar('format.code'), toolbarShows('format.code', 'active')],
        expect: 'a ‸`b`‸ c',
      },
      {
        name: 'a link',
        given: 'a ‸b‸ c',
        steps: [
          toolbar('format.link', { href: 'https://example.com' }),
          toolbarShows('format.link', 'active'),
        ],
        expect: 'a ‸[b](https://example.com)‸ c',
      },
      {
        name: 'a link taken off',
        given: 'a [‸b‸](https://example.com) c',
        steps: [toolbar('format.link', { href: '' })],
        expect: 'a ‸b‸ c',
      },
      {
        name: 'no marks in a code block',
        given: '```\na ‸b‸ c\n```',
        steps: [
          toolbarShows('format.bold', 'hidden'),
          toolbarShows('format.link', 'hidden'),
          toolbarShows('format.footnote', 'hidden'),
        ],
        expect: '```\na ‸b‸ c\n```',
      },
    ],
  },
  {
    title: 'VFM from the toolbar',
    cases: [
      {
        name: 'a note',
        given: 'a ‸note‸ b',
        steps: [
          toolbar('format.footnote'),
          toolbarShows('format.footnote', 'active'),
        ],
        expect: 'a ^[‸note‸] b',
      },
      {
        name: 'a note selected around it is taken off',
        given: 'a ‸^[note]‸ b',
        steps: [
          toolbarShows('format.footnote', 'active'),
          toolbar('format.footnote'),
        ],
        expect: 'a ‸note‸ b',
      },
      {
        name: 'no note of a selection that holds a note',
        given: '‸a ^[b] c‸',
        steps: [toolbarShows('format.footnote', 'disabled')],
        expect: '‸a ^[b] c‸',
      },
      {
        name: 'a ruby',
        given: 'a ‸漢字‸ b',
        steps: [
          toolbar('format.ruby', { text: 'かんじ' }),
          toolbarShows('format.ruby', 'active'),
        ],
        expect: 'a {‸漢字‸|かんじ} b',
      },
      {
        name: 'a ruby made again changes its text',
        given: 'a ‸漢字‸ b',
        steps: [
          toolbar('format.ruby', { text: 'かんじ' }),
          toolbar('format.ruby', { text: 'カンジ' }),
        ],
        expect: 'a {‸漢字‸|カンジ} b',
      },
      {
        name: 'no ruby of a selection that holds a ruby',
        given: '‸a {漢字|かんじ} b‸',
        steps: [toolbarShows('format.ruby', 'disabled')],
        expect: '‸a {漢字|かんじ} b‸',
      },
      {
        name: 'attributes of a link',
        given: 'a [‸b‸](u) c',
        steps: [toolbar('format.attributes', { text: '.x' })],
        expect: 'a ‸[b](u){.x}‸ c',
      },
      {
        name: 'no attributes of plain text',
        given: 'a ‸b‸ c',
        steps: [toolbarShows('format.attributes', 'hidden')],
        expect: 'a ‸b‸ c',
      },
      {
        name: 'math edited',
        given: 'a $x$ ‸b',
        steps: [selectNode('math'), toolbar('math.edit', { latex: 'y' })],
        expect: 'a $y$ b',
      },
      {
        name: 'a reference edited',
        given: 'a[^1] ‸b',
        steps: [
          selectNode('footnoteReference'),
          toolbar('footnote-reference.edit', { label: 'x' }),
        ],
        expect: 'a[^x] b',
      },
    ],
  },
  {
    title: 'blocks from the toolbar',
    cases: [
      {
        name: 'a heading',
        given: 'a ‸b‸ c',
        steps: [toolbar('block.heading-2')],
        expect: '## a ‸b‸ c',
      },
    ],
  },
  {
    title: 'the slash menu',
    cases: [
      {
        name: 'a heading',
        given: '‸',
        steps: [...slash('h1', 'block.heading-1'), 'a'],
        expect: '# a‸',
      },
      {
        name: 'a horizontal rule',
        given: '‸',
        steps: [...slash('hr', 'insert.horizontal-rule'), 'a'],
        expect: '***\n\na‸',
      },
      {
        name: 'a ruby',
        given: 'a‸',
        steps: [
          ' ',
          ...slash('ruby', 'insert.ruby', { base: '漢字', text: 'かんじ' }),
        ],
        expect: 'a {漢字|かんじ}‸',
      },
      {
        name: 'math',
        given: 'a‸',
        steps: [' ', ...slash('math', 'insert.math', { latex: 'x^2' })],
        expect: 'a $x^2$‸',
      },
      {
        name: 'display math',
        given: '‸',
        steps: [
          ...slash('math', 'insert.math', { latex: 'x^2', display: true }),
        ],
        expect: '$$x^2$$‸',
      },
      {
        name: 'a link',
        given: 'a‸',
        steps: [
          ' ',
          ...slash('link', 'insert.link', {
            href: 'https://example.com',
            text: 'b',
          }),
        ],
        expect: 'a [b](https://example.com)‸',
      },
      {
        name: 'no note',
        given: 'a‸',
        steps: [
          type(' /note'),
          run('see no note listed', (editor) => {
            const listed = listedCommands(editor) ?? [];
            for (const id of ['insert.footnote', 'insert.footnote-reference']) {
              if (listed.includes(command(id))) {
                throw new Error(`The menu lists ${id}`);
              }
            }
          }),
        ],
        expect: 'a /note‸',
      },
      {
        name: 'a link',
        given: 'a‸',
        steps: [
          ' ',
          ...trigger('[', 'insert.link', {
            href: 'https://example.com',
            text: 'b',
          }),
        ],
        expect: 'a [b](https://example.com)‸',
      },
    ],
  },
];

describeCases(
  { name: 'node' },
  () =>
    createNodeDriver([
      PubExtensions.configure({}),
      ...createEditorMenuExtensions(),
    ]),
  suites,
);
