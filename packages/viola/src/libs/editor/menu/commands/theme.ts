import type { Editor } from '@tiptap/core';
import type { ComponentType } from 'react';

import { CROSS_REFERENCE } from '@v/tiptap-extensions';
import {
  ArrowDownUpIcon,
  CircleDotIcon,
  CodeIcon,
  FrameIcon,
  HashIcon,
  ImageIcon,
  InfoIcon,
  LightbulbIcon,
  PanelRightIcon,
  SquareSigmaIcon,
  TableIcon,
  TriangleAlertIcon,
  TypeIcon,
} from '@v/ui/icon';
import { CrossReferencePanel } from '../../../../components/content-editor/panels/cross-reference-panel';
import { m } from '../../../../generated/paraglide/messages';
import { selectedReference } from '../../cross-reference';
import { themeStyles } from '../../theme-support';
import { registerEditorMenuCommand } from '../registry';
import { isInCodeBlock, splitKeywords } from './utils';

type Icon = ComponentType<{ className?: string }>;

// The theme's look is the reason to offer the markup, so markup it has no
// rule for is not offered at all.
const styled = (type: string) => (editor: Editor) => themeStyles(editor, type);

const isTextSelection = (editor: Editor) =>
  !isInCodeBlock(editor) &&
  !editor.state.selection.empty &&
  selectedReference(editor) === null;

function registerMarkCommand(
  id: string,
  type: string,
  label: () => string,
  icon: Icon,
) {
  registerEditorMenuCommand({
    id,
    surfaces: ['selection'],
    label,
    icon,
    isActive: (editor) => editor.isActive(type),
    isEnabled: (editor) =>
      editor.isActive(type)
        ? editor.can().unsetHtmlElement(type)
        : editor.can().setHtmlElement(type),
    isVisible: (editor) => styled(type)(editor) && isTextSelection(editor),
    run: ({ editor }) => {
      const chain = editor.chain().focus();
      if (editor.isActive(type)) {
        chain.unsetHtmlElement(type);
      } else {
        chain.setHtmlElement(type);
      }
      chain.run();
    },
  });
}

registerMarkCommand('format.tcy', 'tcy', m.editor_command_tcy, ArrowDownUpIcon);
registerMarkCommand(
  'format.upright',
  'upright',
  m.editor_command_upright,
  TypeIcon,
);
registerMarkCommand(
  'format.sesame',
  'sesame',
  m.editor_command_sesame,
  CircleDotIcon,
);

function registerBlockCommand(
  id: string,
  type: string,
  label: () => string,
  keywords: () => string,
  icon: Icon,
) {
  registerEditorMenuCommand({
    id,
    surfaces: ['trigger'],
    label,
    keywords: () => splitKeywords(keywords()),
    icon,
    isEnabled: (editor) => editor.can().setHtmlElement(type),
    isVisible: styled(type),
    run: ({ editor }) => {
      editor.chain().focus().setHtmlElement(type).run();
    },
  });
}

registerBlockCommand(
  'block.equation',
  'equationBlock',
  m.editor_command_equation,
  m.editor_command_equation_keywords,
  SquareSigmaIcon,
);
registerBlockCommand(
  'block.theorem',
  'theoremBlock',
  m.editor_command_theorem,
  m.editor_command_theorem_keywords,
  LightbulbIcon,
);
registerBlockCommand(
  'block.sidenote',
  'sidenote',
  m.editor_command_sidenote,
  m.editor_command_sidenote_keywords,
  PanelRightIcon,
);
registerBlockCommand(
  'block.note',
  'noteBlock',
  m.editor_command_note,
  m.editor_command_note_keywords,
  InfoIcon,
);
registerBlockCommand(
  'block.warning',
  'warningBlock',
  m.editor_command_warning,
  m.editor_command_warning_keywords,
  TriangleAlertIcon,
);
registerBlockCommand(
  'block.frame',
  'frameBlock',
  m.editor_command_frame,
  m.editor_command_frame_keywords,
  FrameIcon,
);
registerBlockCommand(
  'block.figure-caption',
  'figureCaption',
  m.editor_command_figure_caption,
  m.editor_command_figure_caption_keywords,
  ImageIcon,
);
registerBlockCommand(
  'block.table-caption',
  'tableCaption',
  m.editor_command_table_caption,
  m.editor_command_table_caption_keywords,
  TableIcon,
);
registerBlockCommand(
  'block.listing-caption',
  'listingCaption',
  m.editor_command_listing_caption,
  m.editor_command_listing_caption_keywords,
  CodeIcon,
);

registerEditorMenuCommand({
  id: 'insert.cross-reference',
  surfaces: ['trigger'],
  label: m.editor_command_insert_cross_reference,
  keywords: () => [
    ...splitKeywords(m.editor_command_insert_cross_reference_keywords()),
    'ref',
  ],
  icon: HashIcon,
  isEnabled: (editor) =>
    editor
      .can()
      .setHtmlElement(CROSS_REFERENCE, { 'data-ref': 'sec', href: '#x' }),
  isVisible: styled(CROSS_REFERENCE),
  panel: CrossReferencePanel,
});

registerEditorMenuCommand({
  id: 'cross-reference.edit',
  surfaces: ['selection'],
  label: m.editor_command_cross_reference,
  icon: HashIcon,
  isVisible: (editor) => selectedReference(editor) !== null,
  value: (editor) => String(selectedReference(editor)?.attrs.href ?? ''),
  panel: CrossReferencePanel,
});
