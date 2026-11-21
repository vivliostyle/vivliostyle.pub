import type { Extensions } from '@tiptap/core';

import { TriggerMenu } from '@v/tiptap-extensions/trigger-menu';
import { getActiveTriggers } from './config';
import {
  closeTriggerMenuSession,
  handleTriggerMenuKeyDown,
  openTriggerMenu,
  updateTriggerMenu,
} from './trigger-state';

import './commands';

export function createEditorMenuExtensions(): Extensions {
  return [
    TriggerMenu.configure({
      getTriggers: getActiveTriggers,
      onOpen: openTriggerMenu,
      onUpdate: updateTriggerMenu,
      onClose: closeTriggerMenuSession,
      onKeyDown: handleTriggerMenuKeyDown,
    }),
  ];
}
