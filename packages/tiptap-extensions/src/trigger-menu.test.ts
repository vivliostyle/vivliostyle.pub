import { Editor, getSchema } from '@tiptap/core';
import { Code } from '@tiptap/extension-code';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Slice } from '@tiptap/pm/model';
import { EditorState, Plugin, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import {
  type ActiveTrigger,
  applyTriggerMenuTransaction,
  findTriggerMatch,
  getActiveTrigger,
  getTriggerMenuRange,
  isOutsideCode,
  resolveActiveTrigger,
  TriggerMenu,
  triggerMenuPluginKey,
} from './trigger-menu';

const schema = getSchema([
  Document,
  Paragraph,
  Text,
  Code,
  CodeBlock,
  HardBreak,
]);

const triggers = [
  { menuId: 'slash', chars: ['/', '／'] },
  { menuId: 'media', chars: ['!', '！'] },
];

function createState(text = '') {
  const paragraph = schema.node(
    'paragraph',
    null,
    text ? [schema.text(text)] : [],
  );
  const doc = schema.node('doc', null, [paragraph]);
  const state = EditorState.create({
    schema,
    doc,
    plugins: [
      new Plugin<ActiveTrigger | null>({
        key: triggerMenuPluginKey,
        state: {
          init: () => null,
          apply: (tr, value) => applyTriggerMenuTransaction(value, tr),
        },
      }),
    ],
  });
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1 + text.length)),
  );
}

function typeTrigger(state: EditorState, trigger = '/', menuId = 'slash') {
  const from = state.selection.from;
  return state.apply(
    state.tr.insertText(trigger).setMeta(triggerMenuPluginKey, {
      type: 'open',
      active: { menuId, trigger, from },
    }),
  );
}

function type(state: EditorState, text: string) {
  return state.apply(state.tr.insertText(text));
}

describe('findTriggerMatch', () => {
  it('matches a trigger at the start of the text', () => {
    expect(findTriggerMatch('/', triggers)).toEqual({
      menuId: 'slash',
      trigger: '/',
      offset: 0,
    });
  });

  it('matches a trigger after whitespace, including U+3000', () => {
    expect(findTriggerMatch('foo /', triggers)?.offset).toBe(4);
    expect(findTriggerMatch('あ　／', triggers)).toEqual({
      menuId: 'slash',
      trigger: '／',
      offset: 2,
    });
    expect(findTriggerMatch('a\n!', triggers)?.menuId).toBe('media');
  });

  it('does not match a trigger in the middle of a word', () => {
    expect(findTriggerMatch('and/', triggers)).toBeNull();
    expect(findTriggerMatch('すごい！', triggers)).toBeNull();
  });

  it('does not match after an inline leaf node', () => {
    expect(findTriggerMatch('￼/', triggers)).toBeNull();
  });

  it('supports multi-character triggers', () => {
    const match = findTriggerMatch('see img:', [
      { menuId: 'image', chars: ['img:'] },
    ]);
    expect(match).toEqual({ menuId: 'image', trigger: 'img:', offset: 4 });
  });

  it('ignores empty trigger strings', () => {
    expect(findTriggerMatch('x', [{ menuId: 'x', chars: [''] }])).toBeNull();
  });
});

describe('isOutsideCode', () => {
  it('allows plain paragraphs', () => {
    expect(isOutsideCode(createState('foo'), 4)).toBe(true);
  });

  it('rejects code blocks', () => {
    const doc = schema.node('doc', null, [
      schema.node('codeBlock', null, [schema.text('foo')]),
    ]);
    const state = EditorState.create({ schema, doc });
    expect(isOutsideCode(state, 2)).toBe(false);
  });

  it('rejects positions inside an inline code mark', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('foo', [schema.marks.code.create()]),
      ]),
    ]);
    const state = EditorState.create({ schema, doc });
    expect(isOutsideCode(state, 3)).toBe(false);
  });

  it('rejects stored code marks', () => {
    const state = createState('');
    const next = state.apply(
      state.tr.addStoredMark(schema.marks.code.create()),
    );
    expect(isOutsideCode(next, 1)).toBe(false);
  });
});

describe('applyTriggerMenuTransaction', () => {
  it('opens on the open meta and tracks the query', () => {
    let state = typeTrigger(createState());
    expect(getActiveTrigger(state)).toEqual({
      menuId: 'slash',
      trigger: '/',
      from: 1,
    });
    state = type(state, 'h1');
    const active = getActiveTrigger(state);
    expect(active).not.toBeNull();
    expect(
      active && resolveActiveTrigger(active, state.doc, state.selection),
    ).toEqual({ range: { from: 1, to: 4 }, query: 'h1' });
    expect(getTriggerMenuRange(state)).toEqual({ from: 1, to: 4 });
  });

  it('closes when whitespace is typed', () => {
    let state = typeTrigger(createState());
    state = type(state, 'h ');
    expect(getActiveTrigger(state)).toBeNull();
  });

  it('closes when the trigger is deleted', () => {
    let state = typeTrigger(createState());
    state = state.apply(state.tr.delete(1, 2));
    expect(getActiveTrigger(state)).toBeNull();
  });

  it('closes when the cursor moves before the trigger', () => {
    let state = typeTrigger(createState('ab '));
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    expect(getActiveTrigger(state)).toBeNull();
  });

  it('closes when a range is selected', () => {
    let state = typeTrigger(createState());
    state = type(state, 'abc');
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2, 4)),
    );
    expect(getActiveTrigger(state)).toBeNull();
  });

  it('maps the trigger position through edits before it', () => {
    let state = typeTrigger(createState(' '));
    state = state.apply(state.tr.insertText('foo', 1));
    expect(getActiveTrigger(state)?.from).toBe(5);
  });

  it('survives a whole-document replacement such as a remote Yjs update', () => {
    let state = typeTrigger(createState('a '));
    state = type(state, 'h');
    const head = state.selection.head;
    const tr = state.tr.replace(
      0,
      state.doc.content.size,
      new Slice(state.doc.content, 0, 0),
    );
    tr.setSelection(TextSelection.create(tr.doc, head));
    state = state.apply(tr);
    expect(getActiveTrigger(state)?.from).toBe(3);
    expect(getTriggerMenuRange(state)).toEqual({ from: 3, to: 5 });
  });

  it('closes on the close meta', () => {
    let state = typeTrigger(createState());
    state = state.apply(
      state.tr.setMeta(triggerMenuPluginKey, { type: 'close' }),
    );
    expect(getActiveTrigger(state)).toBeNull();
  });

  it('does not open without the open meta', () => {
    const state = type(createState(), '/');
    expect(getActiveTrigger(state)).toBeNull();
  });
});

describe('TriggerMenu', () => {
  it('closes when a command turns the textblock into code', () => {
    const editor = new Editor({
      element: null,
      extensions: [
        Document,
        Paragraph,
        Text,
        CodeBlock,
        TriggerMenu.configure({ getTriggers: () => triggers }),
      ],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    // A headless editor's state has no plugins.
    editor.view.updateState(
      editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
    );
    editor.commands.setTextSelection(1);
    editor.view.dispatch(
      editor.state.tr.insertText('/h1').setMeta(triggerMenuPluginKey, {
        type: 'open',
        active: { menuId: 'slash', trigger: '/', from: 1 },
      }),
    );
    expect(getTriggerMenuRange(editor.state)).toEqual({ from: 1, to: 4 });
    editor.commands.toggleCodeBlock();
    expect(getActiveTrigger(editor.state)).toBeNull();
    editor.destroy();
  });
});
