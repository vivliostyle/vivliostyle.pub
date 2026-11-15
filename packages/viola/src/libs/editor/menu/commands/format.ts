import type { ChainedCommands, Editor } from '@tiptap/core';
import type { ComponentType } from 'react';

import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from '@v/ui/icon';
import { LinkPanel } from '../../../../components/content-editor/link-panel';
import { m } from '../../../../generated/paraglide/messages';
import { registerEditorMenuCommand } from '../registry';
import { isInCodeBlock } from './utils';

// Code blocks cannot hold marks, so these never apply there.
const isOutsideCodeBlock = (editor: Editor) => !isInCodeBlock(editor);

interface MarkCommandSpec {
  id: string;
  mark: string;
  label: () => string;
  icon: ComponentType<{ className?: string }>;
  shortcut: string;
  toggle: (chain: ChainedCommands) => ChainedCommands;
}

function registerMarkCommand({
  id,
  mark,
  label,
  icon,
  shortcut,
  toggle,
}: MarkCommandSpec): void {
  registerEditorMenuCommand({
    id,
    surfaces: ['selection'],
    label,
    icon,
    shortcut,
    isActive: (editor: Editor) => editor.isActive(mark),
    isEnabled: (editor: Editor) => toggle(editor.can().chain()).run(),
    isVisible: isOutsideCodeBlock,
    run: ({ editor }) => {
      toggle(editor.chain().focus()).run();
    },
  });
}

registerMarkCommand({
  id: 'format.bold',
  mark: 'bold',
  label: m.editor_command_bold,
  icon: BoldIcon,
  shortcut: 'Mod-b',
  toggle: (chain) => chain.toggleBold(),
});

registerMarkCommand({
  id: 'format.italic',
  mark: 'italic',
  label: m.editor_command_italic,
  icon: ItalicIcon,
  shortcut: 'Mod-i',
  toggle: (chain) => chain.toggleItalic(),
});

registerMarkCommand({
  id: 'format.strike',
  mark: 'strike',
  label: m.editor_command_strike,
  icon: StrikethroughIcon,
  shortcut: 'Mod-Shift-s',
  toggle: (chain) => chain.toggleStrike(),
});

registerMarkCommand({
  id: 'format.code',
  mark: 'code',
  label: m.editor_command_code,
  icon: CodeIcon,
  shortcut: 'Mod-e',
  toggle: (chain) => chain.toggleCode(),
});

// Not in the default toolbar: VFM has no underline syntax, so `++text++`
// would not render in the published book.
registerMarkCommand({
  id: 'format.underline',
  mark: 'underline',
  label: m.editor_command_underline,
  icon: UnderlineIcon,
  shortcut: 'Mod-u',
  toggle: (chain) => chain.toggleUnderline(),
});

registerEditorMenuCommand({
  id: 'format.link',
  surfaces: ['selection'],
  label: m.editor_command_link,
  icon: LinkIcon,
  isActive: (editor) => editor.isActive('link'),
  isEnabled: (editor) => editor.can().setMark('link'),
  isVisible: isOutsideCodeBlock,
  panel: LinkPanel,
});
