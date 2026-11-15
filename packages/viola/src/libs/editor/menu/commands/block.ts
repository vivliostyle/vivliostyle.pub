import type { ComponentType } from 'react';

import { type BlockFormat, getBlockFormat } from '@v/tiptap-extensions';
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  Heading5Icon,
  Heading6Icon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  SquareCodeIcon,
  TextQuoteIcon,
} from '@v/ui/icon';
import { m } from '../../../../generated/paraglide/messages';
import { registerEditorMenuCommand } from '../registry';
import { splitKeywords } from './utils';

interface BlockCommandSpec {
  type: BlockFormat;
  label: () => string;
  keywords: () => readonly string[];
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
}

function registerBlockCommand({
  type,
  label,
  keywords,
  icon,
  shortcut,
}: BlockCommandSpec): void {
  registerEditorMenuCommand({
    id: `block.${type}`,
    surfaces: ['selection', 'trigger'],
    label,
    keywords,
    icon,
    shortcut,
    isActive: (editor) => getBlockFormat(editor.state) === type,
    isEnabled: (editor) => editor.can().setBlockFormat(type),
    run: ({ editor }) => {
      editor.chain().focus().setBlockFormat(type).run();
    },
  });
}

registerBlockCommand({
  type: 'paragraph',
  label: m.editor_command_paragraph,
  keywords: () => [
    ...splitKeywords(m.editor_command_paragraph_keywords()),
    'p',
  ],
  icon: PilcrowIcon,
});

const headingIcons = [
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  Heading5Icon,
  Heading6Icon,
];

for (const level of [1, 2, 3, 4, 5, 6] as const) {
  registerBlockCommand({
    type: `heading-${level}`,
    label: () => m.editor_command_heading({ level }),
    keywords: () => [
      ...splitKeywords(m.editor_command_heading_keywords()),
      `h${level}`,
      '#'.repeat(level),
    ],
    icon: headingIcons[level - 1] ?? PilcrowIcon,
    shortcut: `Mod-Alt-${level}`,
  });
}

registerBlockCommand({
  type: 'blockquote',
  label: m.editor_command_blockquote,
  keywords: () => [
    ...splitKeywords(m.editor_command_blockquote_keywords()),
    'quote',
    '>',
  ],
  icon: TextQuoteIcon,
  shortcut: 'Mod-Shift-b',
});

registerBlockCommand({
  type: 'bullet-list',
  label: m.editor_command_bullet_list,
  keywords: () => [
    ...splitKeywords(m.editor_command_bullet_list_keywords()),
    'ul',
    '-',
  ],
  icon: ListIcon,
  shortcut: 'Mod-Shift-8',
});

registerBlockCommand({
  type: 'ordered-list',
  label: m.editor_command_ordered_list,
  keywords: () => [
    ...splitKeywords(m.editor_command_ordered_list_keywords()),
    'ol',
    '1.',
  ],
  icon: ListOrderedIcon,
  shortcut: 'Mod-Shift-7',
});

registerBlockCommand({
  type: 'code-block',
  label: m.editor_command_code_block,
  keywords: () => [
    ...splitKeywords(m.editor_command_code_block_keywords()),
    'code',
    '```',
  ],
  icon: SquareCodeIcon,
  shortcut: 'Mod-Alt-c',
});
