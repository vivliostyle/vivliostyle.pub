import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collapseSeparators,
  defaultEditorMenuConfig,
  editorMenuConfig,
  filterVisibleEntries,
  flattenCommands,
  getActiveTriggers,
  resolveMenuEntries,
} from './config';
import {
  registerEditorMenuCommand,
  registerEditorMenuGroupLabel,
} from './registry';
import type { EditorMenuCommand } from './types';

function command(
  id: string,
  surfaces: EditorMenuCommand['surfaces'] = ['selection', 'trigger'],
): EditorMenuCommand {
  const registered: EditorMenuCommand = { id, surfaces, label: () => id };
  registerEditorMenuCommand(registered);
  return registered;
}

const alpha = command('test.alpha');
const beta = command('test.beta');
const selectionOnly = command('test.selection-only', ['selection']);
registerEditorMenuGroupLabel('test-group', () => 'Test group');

afterEach(() => {
  editorMenuConfig.triggers = structuredClone(defaultEditorMenuConfig.triggers);
  vi.restoreAllMocks();
});

describe('resolveMenuEntries', () => {
  it('resolves command ids in order', () => {
    expect(resolveMenuEntries(['test.beta', 'test.alpha'], 'trigger')).toEqual([
      { type: 'command', command: beta },
      { type: 'command', command: alpha },
    ]);
  });

  it('skips unknown ids and commands that do not fit the surface', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entries = resolveMenuEntries(
      ['test.unknown', 'test.selection-only', 'test.alpha'],
      'trigger',
    );
    expect(flattenCommands(entries)).toEqual([alpha]);
    expect(
      flattenCommands(resolveMenuEntries(['test.selection-only'], 'selection')),
    ).toEqual([selectionOnly]);
  });

  it('uses the registered group label unless one is configured', () => {
    const [registered, custom] = resolveMenuEntries(
      [
        { type: 'group', id: 'test-group', items: ['test.alpha'] },
        { type: 'group', id: 'other', label: 'Custom', items: ['test.beta'] },
      ],
      'trigger',
    );
    expect(registered?.type === 'group' && registered.label()).toBe(
      'Test group',
    );
    expect(custom?.type === 'group' && custom.label()).toBe('Custom');
  });

  it('drops groups that end up empty and the separators around them', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entries = resolveMenuEntries(
      [
        { type: 'separator' },
        'test.alpha',
        { type: 'separator' },
        { type: 'group', id: 'empty', items: ['test.unknown'] },
        { type: 'separator' },
        'test.beta',
        { type: 'separator' },
      ],
      'trigger',
    );
    expect(entries.map((entry) => entry.type)).toEqual([
      'command',
      'separator',
      'command',
    ]);
  });
});

describe('collapseSeparators', () => {
  it('removes leading, trailing and repeated separators', () => {
    expect(
      collapseSeparators([
        { type: 'separator' },
        { type: 'command', command: alpha },
        { type: 'separator' },
        { type: 'separator' },
        { type: 'command', command: beta },
        { type: 'separator' },
      ]).map((entry) => entry.type),
    ).toEqual(['command', 'separator', 'command']);
  });
});

describe('filterVisibleEntries', () => {
  it('drops hidden commands, groups left empty and their separators', () => {
    const editor = {} as Editor;
    const hidden: EditorMenuCommand = {
      id: 'test.hidden',
      surfaces: ['selection'],
      label: () => 'hidden',
      isVisible: (target) => target !== editor,
    };
    const entries = filterVisibleEntries(
      [
        { type: 'command', command: alpha },
        { type: 'separator' },
        { type: 'command', command: hidden },
        { type: 'separator' },
        { type: 'group', id: 'g', label: () => 'g', commands: [hidden] },
        { type: 'separator' },
        {
          type: 'dropdown',
          id: 'd',
          label: () => 'd',
          commands: [hidden, beta],
        },
      ],
      editor,
    );
    expect(entries.map((entry) => entry.type)).toEqual([
      'command',
      'separator',
      'dropdown',
    ]);
    expect(flattenCommands(entries)).toEqual([alpha, beta]);
  });
});

describe('getActiveTriggers', () => {
  it('returns enabled menus that have at least one command', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    editorMenuConfig.triggers = [
      { id: 'a', enabled: true, chars: ['/', '／'], items: ['test.alpha'] },
      { id: 'b', enabled: false, chars: ['!'], items: ['test.alpha'] },
      { id: 'c', enabled: true, chars: ['@'], items: ['test.unknown'] },
    ];
    expect(getActiveTriggers()).toEqual([{ menuId: 'a', chars: ['/', '／'] }]);
  });

  it('gives a character to the first menu that claims it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    editorMenuConfig.triggers = [
      { id: 'a', enabled: true, chars: ['/'], items: ['test.alpha'] },
      { id: 'b', enabled: true, chars: ['/', '!', ''], items: ['test.beta'] },
    ];
    expect(getActiveTriggers()).toEqual([
      { menuId: 'a', chars: ['/'] },
      { menuId: 'b', chars: ['!'] },
    ]);
  });
});
