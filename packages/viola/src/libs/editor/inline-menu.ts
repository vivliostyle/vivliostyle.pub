import type { Editor } from '@tiptap/core';
import type { ComponentType } from 'react';
import { proxy } from 'valtio';

import type { ContentId } from '../../stores/proxies/content';

export interface InlineMenuSelectContext {
  editor: Editor;
  from: number;
  contentId: ContentId;
  close: () => void;
}

export interface InlineMenuItemDef {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onSelect: (ctx: InlineMenuSelectContext) => void | Promise<void>;
}

export interface InlineMenuPlugin {
  id: string;
  triggers: string[];
  items: InlineMenuItemDef[];
}

export const inlineMenuPlugins: InlineMenuPlugin[] = [];

export const inlineMenuState = proxy({
  trigger: null as string | null,
  contentId: null as ContentId | null,
  from: 0,
  coords: null as { top: number; bottom: number; left: number } | null,
  closeInlineMenu() {
    this.trigger = null;
    this.contentId = null;
    this.coords = null;
  },
});

export function registerInlineMenuPlugin(plugin: InlineMenuPlugin): void {
  if (!inlineMenuPlugins.some((p) => p.id === plugin.id)) {
    inlineMenuPlugins.push(plugin);
  }
}

export function getItemsForTrigger(trigger: string): InlineMenuItemDef[] {
  return inlineMenuPlugins.flatMap((p) =>
    p.triggers.includes(trigger) ? p.items : [],
  );
}

export function getAllTriggers(): string[] {
  return [...new Set(inlineMenuPlugins.flatMap((p) => p.triggers))];
}
