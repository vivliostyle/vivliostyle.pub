import type { Editor } from '@tiptap/core';
import { proxy, ref } from 'valtio';

import type { TriggerMenuMatch } from '@v/tiptap-extensions/trigger-menu';

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
