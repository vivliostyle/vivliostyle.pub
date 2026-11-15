import { isMacOS } from '@tiptap/core';

/** Formats a TipTap shortcut such as `Mod-Shift-s` for display. */
export function formatShortcut(shortcut: string): string {
  const parts = shortcut.split('-');
  const key = parts.pop() ?? '';
  const modifiers = new Set(parts);
  const keyLabel = key.length === 1 ? key.toUpperCase() : key;
  if (isMacOS()) {
    return [
      modifiers.has('Ctrl') ? '⌃' : '',
      modifiers.has('Alt') ? '⌥' : '',
      modifiers.has('Shift') ? '⇧' : '',
      modifiers.has('Mod') ? '⌘' : '',
      keyLabel,
    ].join('');
  }
  return [
    modifiers.has('Mod') || modifiers.has('Ctrl') ? 'Ctrl' : '',
    modifiers.has('Alt') ? 'Alt' : '',
    modifiers.has('Shift') ? 'Shift' : '',
    keyLabel,
  ]
    .filter(Boolean)
    .join('+');
}
