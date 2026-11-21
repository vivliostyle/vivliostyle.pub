import type { Editor } from '@tiptap/core';
import { proxy } from 'valtio';

import type { TriggerDefinition } from '@v/tiptap-extensions/trigger-menu';
import { getEditorMenuCommand, getEditorMenuGroupLabel } from './registry';
import type {
  EditorMenuCommand,
  EditorMenuConfig,
  MenuEntry,
  MenuSurface,
  ResolvedMenuEntry,
} from './types';

export const defaultEditorMenuConfig: EditorMenuConfig = {
  selection: {
    enabled: true,
    items: [
      {
        type: 'dropdown',
        id: 'block-type',
        items: [
          'block.paragraph',
          'block.heading-1',
          'block.heading-2',
          'block.heading-3',
          'block.blockquote',
          'block.bullet-list',
          'block.ordered-list',
          'block.code-block',
        ],
      },
      'code-block.info',
      { type: 'separator' },
      'format.bold',
      'format.italic',
      'format.strike',
      'format.code',
      { type: 'separator' },
      'format.link',
    ],
  },
  triggers: [
    {
      id: 'slash',
      enabled: true,
      chars: ['/', '／'],
      items: [
        {
          type: 'group',
          id: 'basic',
          items: [
            'block.paragraph',
            'block.heading-1',
            'block.heading-2',
            'block.heading-3',
          ],
        },
        {
          type: 'group',
          id: 'list',
          items: [
            'block.bullet-list',
            'block.ordered-list',
            'block.blockquote',
          ],
        },
        {
          type: 'group',
          id: 'insert',
          items: ['block.code-block', 'insert.horizontal-rule', 'insert.image'],
        },
      ],
    },
    {
      id: 'media',
      enabled: true,
      chars: ['!', '！'],
      items: ['insert.image'],
    },
    {
      id: 'link',
      enabled: true,
      // Not 「: Japanese IMEs type it for [, and it opens dialogue lines.
      chars: ['[', '［'],
      items: ['insert.link'],
    },
  ],
};

export const editorMenuConfig = proxy<EditorMenuConfig>(
  structuredClone(defaultEditorMenuConfig),
);

const warned = new Set<string>();

// Trigger lookups run on every keystroke, so each problem is reported once.
function warnOnce(message: string): void {
  if (!import.meta.env.DEV || warned.has(message)) {
    return;
  }
  warned.add(message);
  console.warn(`[editor-menu] ${message}`);
}

function resolveCommands(
  ids: readonly string[],
  surface: MenuSurface,
): EditorMenuCommand[] {
  return ids.flatMap((id) => {
    const command = getEditorMenuCommand(id);
    if (!command) {
      warnOnce(`Unknown command "${id}" is ignored.`);
      return [];
    }
    if (!command.surfaces.includes(surface)) {
      warnOnce(`Command "${id}" cannot be placed in the ${surface} menu.`);
      return [];
    }
    return [command];
  });
}

export function collapseSeparators(
  entries: readonly ResolvedMenuEntry[],
): ResolvedMenuEntry[] {
  const result: ResolvedMenuEntry[] = [];
  for (const entry of entries) {
    if (entry.type === 'separator') {
      const last = result.at(-1);
      if (!last || last.type === 'separator') {
        continue;
      }
    }
    result.push(entry);
  }
  while (result.at(-1)?.type === 'separator') {
    result.pop();
  }
  return result;
}

export function resolveMenuEntries(
  entries: readonly MenuEntry[],
  surface: MenuSurface,
): ResolvedMenuEntry[] {
  const resolved: ResolvedMenuEntry[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const [command] = resolveCommands([entry], surface);
      if (command) {
        resolved.push({ type: 'command', command });
      }
      continue;
    }
    if (entry.type === 'separator') {
      resolved.push({ type: 'separator' });
      continue;
    }
    const commands = resolveCommands(entry.items, surface);
    if (commands.length === 0) {
      continue;
    }
    const { id, label } = entry;
    resolved.push({
      type: entry.type,
      id,
      label:
        label !== undefined
          ? () => label
          : (getEditorMenuGroupLabel(id) ?? (() => id)),
      commands,
    });
  }
  return collapseSeparators(resolved);
}

export function filterVisibleEntries(
  entries: readonly ResolvedMenuEntry[],
  editor: Editor,
): ResolvedMenuEntry[] {
  const isVisible = (command: EditorMenuCommand) =>
    command.isVisible?.(editor) ?? true;
  return collapseSeparators(
    entries.flatMap((entry): ResolvedMenuEntry[] => {
      switch (entry.type) {
        case 'separator':
          return [entry];
        case 'command':
          return isVisible(entry.command) ? [entry] : [];
        default: {
          const commands = entry.commands.filter(isVisible);
          return commands.length > 0 ? [{ ...entry, commands }] : [];
        }
      }
    }),
  );
}

export function flattenCommands(
  entries: readonly ResolvedMenuEntry[],
): EditorMenuCommand[] {
  return entries.flatMap((entry) => {
    switch (entry.type) {
      case 'command':
        return [entry.command];
      case 'separator':
        return [];
      default:
        return entry.commands;
    }
  });
}

export function getActiveTriggers(): TriggerDefinition[] {
  const claimed = new Set<string>();
  const result: TriggerDefinition[] = [];
  for (const menu of editorMenuConfig.triggers) {
    if (!menu.enabled) {
      continue;
    }
    if (
      flattenCommands(resolveMenuEntries(menu.items, 'trigger')).length === 0
    ) {
      continue;
    }
    const chars = menu.chars.filter((char) => {
      if (!char) {
        return false;
      }
      if (claimed.has(char)) {
        warnOnce(
          `Trigger "${char}" of menu "${menu.id}" is already used by another menu.`,
        );
        return false;
      }
      claimed.add(char);
      return true;
    });
    if (chars.length > 0) {
      result.push({ menuId: menu.id, chars });
    }
  }
  return result;
}
