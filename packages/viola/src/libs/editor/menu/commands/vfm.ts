import type { Editor } from '@tiptap/core';

import { findSelectedInline, hasDocumentNotation } from '@v/tiptap-extensions';
import {
  attributedMarkOf,
  selectedNodeOf,
  selectedRuby,
} from '@v/tiptap-extensions/operations/vfm';
import {
  LanguagesIcon,
  SigmaIcon,
  StickyNoteIcon,
  SuperscriptIcon,
  TagIcon,
} from '@v/ui/icon';
import { AttributesPanel } from '../../../../components/content-editor/panels/attributes-panel';
import {
  FootnotePanel,
  FootnoteReferencePanel,
} from '../../../../components/content-editor/panels/footnote-panel';
import { MathPanel } from '../../../../components/content-editor/panels/math-panel';
import { RubyPanel } from '../../../../components/content-editor/panels/ruby-panel';
import { m } from '../../../../generated/paraglide/messages';
import { registerEditorMenuCommand } from '../registry';
import { isInCodeBlock, splitKeywords } from './utils';

// A selected math or reference node gets its own command, not the ones for
// text.
const isTextSelection = (editor: Editor) =>
  !isInCodeBlock(editor) &&
  !selectedNodeOf(editor.state, 'math') &&
  !selectedNodeOf(editor.state, 'footnoteReference');

registerEditorMenuCommand({
  id: 'insert.ruby',
  surfaces: ['trigger'],
  label: m.editor_command_insert_ruby,
  keywords: () => [
    ...splitKeywords(m.editor_command_insert_ruby_keywords()),
    'ruby',
  ],
  icon: LanguagesIcon,
  isEnabled: (editor) => editor.can().insertRuby({ base: '-', rubyText: '-' }),
  panel: RubyPanel,
});

registerEditorMenuCommand({
  id: 'insert.math',
  surfaces: ['trigger'],
  label: m.editor_command_insert_math,
  keywords: () => [
    ...splitKeywords(m.editor_command_insert_math_keywords()),
    'math',
    '$',
  ],
  icon: SigmaIcon,
  isEnabled: (editor) => editor.can().setMath({ latex: 'x', display: false }),
  panel: MathPanel,
});

registerEditorMenuCommand({
  id: 'insert.footnote',
  surfaces: ['trigger'],
  label: m.editor_command_insert_footnote,
  keywords: () => [
    ...splitKeywords(m.editor_command_insert_footnote_keywords()),
    'footnote',
    'note',
  ],
  icon: StickyNoteIcon,
  isEnabled: (editor) => editor.can().setInlineFootnote('-'),
  panel: FootnotePanel,
});

registerEditorMenuCommand({
  id: 'insert.footnote-reference',
  surfaces: ['trigger'],
  label: m.editor_command_insert_footnote_reference,
  keywords: () => [
    ...splitKeywords(m.editor_command_insert_footnote_reference_keywords()),
    'footnote',
    'reference',
  ],
  icon: SuperscriptIcon,
  isEnabled: (editor) => editor.can().setFootnoteReference('1'),
  panel: FootnoteReferencePanel,
});

registerEditorMenuCommand({
  id: 'format.ruby',
  surfaces: ['selection'],
  label: m.editor_command_ruby,
  icon: LanguagesIcon,
  isActive: (editor) => selectedRuby(editor.state) !== null,
  isEnabled: (editor) =>
    selectedRuby(editor.state) !== null || editor.can().setRuby('-'),
  isVisible: isTextSelection,
  panel: RubyPanel,
});

registerEditorMenuCommand({
  id: 'format.footnote',
  surfaces: ['selection'],
  label: m.editor_command_footnote,
  icon: StickyNoteIcon,
  isActive: (editor) =>
    findSelectedInline(editor.state, 'inlineFootnote') !== null,
  isEnabled: (editor) => editor.can().toggleInlineFootnote(),
  isVisible: isTextSelection,
  run: ({ editor }) => {
    editor.chain().focus().toggleInlineFootnote().run();
  },
});

registerEditorMenuCommand({
  id: 'format.attributes',
  surfaces: ['selection'],
  label: m.editor_command_attributes,
  icon: TagIcon,
  isActive: (editor) =>
    Boolean(attributedMarkOf(editor.state)?.mark.attrs.attributes),
  isEnabled: (editor) => hasDocumentNotation(editor, 'inlineAttributes'),
  isVisible: (editor) =>
    isTextSelection(editor) && attributedMarkOf(editor.state) !== null,
  panel: AttributesPanel,
});

registerEditorMenuCommand({
  id: 'math.edit',
  surfaces: ['selection'],
  label: m.editor_command_math,
  icon: SigmaIcon,
  isVisible: (editor) => selectedNodeOf(editor.state, 'math') !== null,
  value: (editor) =>
    String(selectedNodeOf(editor.state, 'math')?.attrs.latex ?? '').trim(),
  panel: MathPanel,
});

registerEditorMenuCommand({
  id: 'footnote-reference.edit',
  surfaces: ['selection'],
  label: m.editor_command_footnote_reference,
  icon: SuperscriptIcon,
  isVisible: (editor) =>
    selectedNodeOf(editor.state, 'footnoteReference') !== null,
  value: (editor) =>
    `[^${String(selectedNodeOf(editor.state, 'footnoteReference')?.attrs.label ?? '')}]`,
  panel: FootnoteReferencePanel,
});
