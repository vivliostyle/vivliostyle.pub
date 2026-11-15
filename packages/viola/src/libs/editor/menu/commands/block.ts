import {
  type ChainedCommands,
  CommandManager,
  type Editor,
} from '@tiptap/core';
import { setBlockType } from '@tiptap/pm/commands';
import type { ResolvedPos } from '@tiptap/pm/model';
import type { ComponentType } from 'react';

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

function blockTypeAt($pos: ResolvedPos): string {
  const { parent } = $pos;
  if (parent.type.spec.code) {
    return 'code-block';
  }
  // The nearest wrapper decides, so a paragraph inside a list reads as a list.
  for (let depth = $pos.depth - 1; depth > 0; depth--) {
    switch ($pos.node(depth).type.name) {
      case 'bulletList':
        return 'bullet-list';
      case 'orderedList':
        return 'ordered-list';
      case 'blockquote':
        return 'blockquote';
    }
  }
  if (parent.type.name === 'heading') {
    return `heading-${parent.attrs.level}`;
  }
  return 'paragraph';
}

export function getSelectionBlockType(editor: Editor): string | null {
  const { $from, $to } = editor.state.selection;
  const type = blockTypeAt($from);
  return blockTypeAt($to) === type ? type : null;
}

// can() checks each step against the unchanged document, so a step that relies
// on an earlier one (wrapping in a list after clearNodes) always fails there.
function canRunChain(
  editor: Editor,
  build: (chain: ChainedCommands) => ChainedCommands,
): boolean {
  return build(
    new CommandManager({ editor, state: editor.state }).createChain(),
  ).run();
}

interface BlockCommandSpec {
  type: string;
  label: () => string;
  keywords: () => readonly string[];
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
  apply: (chain: ChainedCommands) => ChainedCommands;
}

function registerBlockCommand({
  type,
  label,
  keywords,
  icon,
  shortcut,
  apply,
}: BlockCommandSpec): void {
  const convert = (chain: ChainedCommands) =>
    apply(
      chain
        // ProseMirror's setBlockType turns code newlines into hard breaks;
        // clearNodes alone would leave raw "\n" in the paragraph.
        .command(({ state, dispatch }) => {
          const paragraph = state.schema.nodes.paragraph;
          if (paragraph) {
            setBlockType(paragraph)(state, dispatch);
          }
          return true;
        })
        // Lifts the block out of lists and quotes so "turn into" doesn't nest
        // the new type inside them.
        .clearNodes(),
    );
  registerEditorMenuCommand({
    id: `block.${type}`,
    surfaces: ['selection', 'trigger'],
    label,
    keywords,
    icon,
    shortcut,
    isActive: (editor) => getSelectionBlockType(editor) === type,
    isEnabled: (editor) =>
      getSelectionBlockType(editor) !== type && canRunChain(editor, convert),
    run: ({ editor }) => {
      convert(editor.chain().focus()).run();
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
  apply: (chain) => chain,
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
    apply: (chain) => chain.setHeading({ level }),
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
  apply: (chain) => chain.setBlockquote(),
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
  apply: (chain) => chain.toggleBulletList(),
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
  apply: (chain) => chain.toggleOrderedList(),
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
  apply: (chain) => chain.setCodeBlock(),
});
