import { Extension } from '@tiptap/core';
import { Bold } from '@tiptap/extension-bold';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { describe, expect, it } from 'vitest';

import { PubExtensions } from '../src/index';
import { type EditorCase, runCase } from './case';
import { UnsupportedStep } from './driver';
import { createNodeDriver, toKeyEvent } from './node-driver';
import { press, select } from './steps';

const extensions = [PubExtensions.configure({})];

const typeYForX = Extension.create({
  name: 'typeYForX',
  addKeyboardShortcuts() {
    return {
      x: ({ editor }) =>
        editor.commands.command(({ tr }) => {
          tr.insertText('Y');
          return true;
        }),
    };
  },
});

const plain = (text: string) => ({ type: 'text', text });
const bold = (text: string) => ({ ...plain(text), marks: [{ type: 'bold' }] });
const paragraph = (...content: object[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content }],
});

async function outcome(
  testCase: Omit<EditorCase, 'name'>,
  driver = createNodeDriver(extensions),
) {
  try {
    return await runCase(driver, { name: 'case', ...testCase });
  } finally {
    driver.destroy();
  }
}

describe('toKeyEvent', () => {
  it('gives a letter held with Shift its key code', () => {
    expect(toKeyEvent('Mod-Shift-b').event).toMatchObject({
      key: 'B',
      keyCode: 66,
      shiftKey: true,
    });
  });

  it('takes the modifier names prosemirror-keymap takes', () => {
    expect(toKeyEvent('Control-a').event.ctrlKey).toBe(true);
    expect(toKeyEvent('c-a').event.ctrlKey).toBe(true);
    expect(toKeyEvent('Cmd-a').event.metaKey).toBe(true);
    expect(toKeyEvent('s-Tab').event.shiftKey).toBe(true);
    expect(toKeyEvent('Alt--').event).toMatchObject({ key: '-', altKey: true });
    expect(toKeyEvent('Space').event.key).toBe(' ');
  });

  it('throws for an unknown modifier', () => {
    expect(() => toKeyEvent('Hyper-a')).toThrow('Unknown modifier "Hyper"');
  });
});

describe('createNodeDriver', () => {
  it('resolves shortcuts held with Shift', async () => {
    expect(
      await outcome({
        given: 'a ‸b‸ c',
        steps: [press('Mod-Shift-s')],
        expect: 'a ‸~~b~~‸ c',
      }),
    ).toEqual([]);
  });

  it('presses a key that moves the caret when a handler takes it', async () => {
    expect(
      await outcome({
        given: 'a‸^[bd]',
        steps: [press('ArrowRight'), 'c'],
        expect: 'a^[bc‸d]',
      }),
    ).toEqual([]);
  });

  it('gives up on a key that moves the caret when no handler takes it', async () => {
    await expect(
      outcome({ given: 'a‸b', steps: [press('ArrowRight')], expect: 'ab‸' }),
    ).rejects.toBeInstanceOf(UnsupportedStep);
    await expect(
      outcome({ given: 'a‸b', steps: [press('Shift-End')], expect: 'a‸b‸' }),
    ).rejects.toBeInstanceOf(UnsupportedStep);
  });

  it('types a character key without modifiers', async () => {
    expect(
      await outcome({ given: 'a‸', steps: [press('b')], expect: 'ab‸' }),
    ).toEqual([]);
  });

  it('throws for a key that nothing handles', async () => {
    await expect(
      outcome({ given: 'a‸', steps: [press('Mod-F12')], expect: 'a‸' }),
    ).rejects.toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({
          message: 'No keymap handles Mod-F12',
        }),
      }),
    );
  });

  it('sends typed characters to keydown handlers first', async () => {
    expect(
      await outcome(
        { given: 'a‸', steps: ['xb'], expect: 'aYb‸' },
        createNodeDriver([...extensions, typeYForX]),
      ),
    ).toEqual([]);
  });

  it('asks the editor props before the plugins', async () => {
    const seen: string[] = [];
    const driver = createNodeDriver([...extensions, typeYForX], {
      handleKeyDown(_view, event) {
        seen.push(event.key);
        return event.key === 'x';
      },
    });
    expect(
      await outcome({ given: 'a‸', steps: ['xb'], expect: 'ab‸' }, driver),
    ).toEqual([]);
    expect(seen).toEqual(['x', 'b']);
  });

  it('deletes a whole grapheme', async () => {
    expect(
      await outcome({
        given: 'a👍🏽‸',
        steps: [press('Backspace')],
        expect: 'a‸',
      }),
    ).toEqual([]);
    expect(
      await outcome({
        given: '‸éb',
        steps: [press('Delete')],
        expect: '‸b',
      }),
    ).toEqual([]);
  });

  it('keeps the marks of what it deletes for the next text, as a view does', async () => {
    const driver = createNodeDriver([Document, Paragraph, Text, Bold]);
    try {
      const { editor } = driver;
      editor.commands.setContent(paragraph(bold('a'), plain('b')));
      editor.commands.setTextSelection(3);
      await driver.perform(press('Backspace'));
      expect(editor.state.storedMarks).toEqual([]);

      editor.commands.setContent(paragraph(plain('a'), bold('bc')));
      editor.commands.setTextSelection(2);
      await driver.perform(press('Delete'));
      expect(editor.state.storedMarks?.map((mark) => mark.type.name)).toEqual([
        'bold',
      ]);
    } finally {
      driver.destroy();
    }
  });
});

describe('the select step', () => {
  it('selects what the marks mark', async () => {
    expect(
      await outcome({
        given: '‸**ab**c',
        steps: [select('**a‸b**c‸'), 'x'],
        expect: '**a**x‸',
      }),
    ).toEqual([]);
  });

  it('throws for marks in another document', async () => {
    await expect(
      outcome({ given: '‸abc', steps: [select('ab‸')], expect: 'abc' }),
    ).rejects.toThrow('Could not select');
  });
});
