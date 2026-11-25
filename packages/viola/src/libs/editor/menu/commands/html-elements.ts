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
  NotebookTextIcon,
  PanelRightIcon,
  RemoveFormattingIcon,
  SquareSigmaIcon,
  TableIcon,
  TriangleAlertIcon,
  TypeIcon,
} from '@v/ui/icon';
import { CrossReferencePanel } from '../../../../components/content-editor/panels/cross-reference-panel';
import { PageFootnotePanel } from '../../../../components/content-editor/panels/footnote-panel';
import { m } from '../../../../generated/paraglide/messages';
import { selectedReference } from '../../cross-reference';
import {
  inElement,
  isStyled,
  PAGE_FOOTNOTE,
  selectedBlockElement,
} from '../../styled-elements';
import { registerEditorMenuCommand } from '../registry';
import { isInCodeBlock, splitKeywords } from './utils';

type Icon = ComponentType<{ className?: string }>;

// The theme's look is the reason to offer the markup, so markup it has no
// rule for is not offered, unless the selection is in some already, which
// can then still be taken away.
const offered = (type: string) => (editor: Editor) =>
  isStyled(editor, type) || inElement(editor, type);

const isTextSelection = (editor: Editor) =>
  !isInCodeBlock(editor) &&
  !editor.state.selection.empty &&
  selectedReference(editor) === null;

/** Gives the selection the element, or takes the one it is in away. */
function toggle(editor: Editor, type: string): void {
  const chain = editor.chain().focus();
  if (inElement(editor, type)) {
    chain.unsetHtmlElement(type);
  } else {
    chain.setHtmlElement(type);
  }
  chain.run();
}

const canToggle = (type: string) => (editor: Editor) =>
  inElement(editor, type)
    ? editor.can().unsetHtmlElement(type)
    : editor.can().setHtmlElement(type);

function registerInlineCommand(
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
    isActive: (editor) => inElement(editor, type),
    isEnabled: canToggle(type),
    isVisible: (editor) => offered(type)(editor) && isTextSelection(editor),
    run: ({ editor }) => toggle(editor, type),
  });
}

registerInlineCommand(
  'format.tcy',
  'tcy',
  m.editor_command_tcy,
  ArrowDownUpIcon,
);
registerInlineCommand(
  'format.upright',
  'upright',
  m.editor_command_upright,
  TypeIcon,
);
registerInlineCommand(
  'format.sesame',
  'sesame',
  m.editor_command_sesame,
  CircleDotIcon,
);
registerInlineCommand(
  'format.page-footnote',
  PAGE_FOOTNOTE,
  m.editor_command_page_footnote,
  NotebookTextIcon,
);

registerEditorMenuCommand({
  id: 'insert.page-footnote',
  surfaces: ['trigger'],
  label: m.editor_command_insert_page_footnote,
  keywords: () =>
    splitKeywords(m.editor_command_insert_page_footnote_keywords()),
  icon: NotebookTextIcon,
  isEnabled: (editor) => editor.can().setHtmlElement(PAGE_FOOTNOTE, null, '-'),
  isVisible: offered(PAGE_FOOTNOTE),
  panel: PageFootnotePanel,
});

const blockLabels = new Map<string, () => string>([
  ['tableFigure', m.editor_command_table_figure],
  ['htmlFigcaption', m.editor_command_table_figure_caption],
]);

function registerBlockCommand(
  id: string,
  type: string,
  label: () => string,
  keywords: () => string,
  icon: Icon,
) {
  blockLabels.set(type, label);
  registerEditorMenuCommand({
    id,
    surfaces: ['trigger'],
    label,
    keywords: () => splitKeywords(keywords()),
    icon,
    isActive: (editor) => inElement(editor, type),
    isEnabled: canToggle(type),
    isVisible: offered(type),
    run: ({ editor }) => toggle(editor, type),
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
  id: 'element.unwrap',
  surfaces: ['selection'],
  label: m.editor_command_unwrap_element,
  icon: RemoveFormattingIcon,
  isVisible: (editor) => selectedBlockElement(editor) !== null,
  isEnabled: (editor) => {
    const selected = selectedBlockElement(editor);
    return selected !== null && editor.can().unsetHtmlElement(selected.type);
  },
  value: (editor) => {
    const selected = selectedBlockElement(editor);
    return selected
      ? (blockLabels.get(selected.type)?.() ?? selected.type)
      : '';
  },
  run: ({ editor }) => {
    const selected = selectedBlockElement(editor);
    if (selected) {
      editor.chain().focus().unsetHtmlElement(selected.type).run();
    }
  },
});

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
  isVisible: offered(CROSS_REFERENCE),
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
