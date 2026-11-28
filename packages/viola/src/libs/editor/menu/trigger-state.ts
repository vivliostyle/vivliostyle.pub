import type { Editor } from '@tiptap/core';
import type { ComponentType } from 'react';
import { proxy, ref } from 'valtio';

import {
  deleteTriggerQuery,
  type TriggerMenuMatch,
} from '@v/tiptap-extensions/trigger-menu';
import { runEditorMenuCommand } from './registry';
import type { EditorMenuCommand, EditorMenuPanelProps } from './types';

export interface TriggerMenuSession {
  editor: Editor;
  menuId: string;
  query: string;
  clientRect: () => DOMRect | null;
  /** Changes on every open, so the menu can reset its highlight. */
  openId: number;
}

export const triggerMenuState = proxy({
  session: null as TriggerMenuSession | null,
});

let nextOpenId = 0;

export function openTriggerMenu(editor: Editor, match: TriggerMenuMatch): void {
  nextOpenId += 1;
  triggerMenuState.session = {
    editor: ref(editor),
    menuId: match.menuId,
    query: match.query,
    clientRect: match.clientRect,
    openId: nextOpenId,
  };
}

export function updateTriggerMenu(
  editor: Editor,
  match: TriggerMenuMatch,
): void {
  const { session } = triggerMenuState;
  if (session?.editor !== editor || session.menuId !== match.menuId) {
    openTriggerMenu(editor, match);
    return;
  }
  if (session.query !== match.query) {
    session.query = match.query;
  }
}

export function closeTriggerMenuSession(editor: Editor): void {
  if (triggerMenuState.session?.editor === editor) {
    triggerMenuState.session = null;
  }
}

type KeyHandler = (event: KeyboardEvent) => boolean;

// Keyed by editor because several editor panes can be mounted at once.
const keyHandlers = new WeakMap<Editor, KeyHandler>();

export function setTriggerMenuKeyHandler(
  editor: Editor,
  handler: KeyHandler | null,
): void {
  if (handler) {
    keyHandlers.set(editor, handler);
  } else {
    keyHandlers.delete(editor);
  }
}

export function handleTriggerMenuKeyDown(
  editor: Editor,
  event: KeyboardEvent,
): boolean {
  return keyHandlers.get(editor)?.(event) ?? false;
}

/**
 * Replaces the trigger and its query with what the command does: runs it,
 * or returns the panel to open at the caret instead. False when the menu is
 * not open or the command does not apply.
 */
export function executeTriggerCommand(
  editor: Editor,
  command: EditorMenuCommand,
): ComponentType<EditorMenuPanelProps> | null | false {
  if (!(command.isEnabled?.(editor) ?? true) || !deleteTriggerQuery(editor)) {
    return false;
  }
  if (command.panel) {
    return command.panel;
  }
  runEditorMenuCommand(command, { editor, surface: 'trigger' });
  return null;
}
