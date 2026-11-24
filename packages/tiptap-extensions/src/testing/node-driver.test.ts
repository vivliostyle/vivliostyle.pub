import { Extension } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { PubExtensions } from '../index';
import { type EditorCase, runCase } from './case';
import { createNodeDriver, toKeyEvent } from './node-driver';
import { press } from './steps';

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

  it('skips keys that move the caret', () => {
    const driver = createNodeDriver(extensions);
    expect(driver.supports(press('ArrowLeft'))).toBe(false);
    expect(driver.supports(press('Shift-End'))).toBe(false);
    expect(driver.supports(press('Enter'))).toBe(true);
    driver.destroy();
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
});
