import type { Editor } from '@tiptap/core';
import type { ComponentType } from 'react';

export type MenuSurface = 'selection' | 'trigger';

export interface EditorMenuRunContext {
  editor: Editor;
  surface: MenuSurface;
}

export interface EditorMenuPanelProps {
  editor: Editor;
  close: () => void;
}

export interface EditorMenuCommand {
  /** Stable identifier referenced from {@link EditorMenuConfig}. */
  id: string;
  surfaces: readonly MenuSurface[];
  label: () => string;
  /** Extra search terms for trigger-menu filtering. */
  keywords?: () => readonly string[];
  icon?: ComponentType<{ className?: string }>;
  /** Display-only, in TipTap notation (e.g. `Mod-b`). */
  shortcut?: string;
  isActive?: (editor: Editor) => boolean;
  isEnabled?: (editor: Editor) => boolean;
  /**
   * Hides the command where it can never apply, such as marks inside a code
   * block or markup the theme has no look for, instead of showing it
   * disabled.
   */
  isVisible?: (editor: Editor) => boolean;
  /** Selection toolbar only: a current value shown as the button's text. */
  value?: (editor: Editor) => string;
  run?: (ctx: EditorMenuRunContext) => void | Promise<void>;
  /**
   * Opened instead of running: in place of the selection toolbar's buttons, or
   * at the caret for trigger menus.
   */
  panel?: ComponentType<EditorMenuPanelProps>;
}

// Everything below is plain JSON so it can later be persisted as a user setting.
export type MenuEntry =
  | string
  | { readonly type: 'separator' }
  | {
      readonly type: 'group' | 'dropdown';
      readonly id: string;
      /** Falls back to the built-in label registered for `id`. */
      readonly label?: string;
      readonly items: readonly string[];
    };

export interface SelectionMenuConfig {
  readonly enabled: boolean;
  readonly items: readonly MenuEntry[];
}

export interface TriggerMenuConfig {
  readonly id: string;
  readonly enabled: boolean;
  readonly chars: readonly string[];
  readonly items: readonly MenuEntry[];
}

export interface EditorMenuConfig {
  selection: SelectionMenuConfig;
  triggers: readonly TriggerMenuConfig[];
}

export interface ResolvedMenuGroup {
  type: 'group' | 'dropdown';
  id: string;
  label: () => string;
  commands: EditorMenuCommand[];
}

export type ResolvedMenuEntry =
  | { type: 'command'; command: EditorMenuCommand }
  | { type: 'separator' }
  | ResolvedMenuGroup;
