import type { Editor } from '@tiptap/core';

import {
  formatAttributes,
  type InlineAttributes,
  isWritableFootnoteLabel,
  isWritableRubyText,
  parseAttributes,
} from '@v/tiptap-extensions';
import {
  getEditableSelectionText,
  getSelectedLinkHref,
  insertLink,
  removeLinkFromSelection,
  selectionHasLink,
  setLinkOnSelection,
} from '@v/tiptap-extensions/operations/link';
import {
  attributedMarkOf,
  isMathSource,
  nextFootnoteLabel,
  selectedNodeOf,
  selectedRuby,
  setMarkAttributes,
} from '@v/tiptap-extensions/operations/vfm';

/**
 * What submitting a panel's form did: the panel closes once it applied or
 * had nothing to apply, and otherwise stays open showing why. The forms
 * leave focusing the editor to the panel, which focuses it as it closes.
 */
export type FormOutcome<Invalid extends string = never> =
  | 'applied'
  | 'dismissed'
  | { invalid: Invalid };

export function openRubyForm(editor: Editor) {
  const ruby = selectedRuby(editor.state);
  // With nothing selected there is no base, so the form asks for one.
  const isInsert = !ruby && editor.state.selection.empty;
  const initialText = ruby ? String(ruby.attrs.rubyText ?? '') : '';
  return {
    hasRuby: ruby !== null,
    isInsert,
    initialText,
    apply({
      base = '',
      text,
    }: {
      base?: string;
      text: string;
    }): FormOutcome<'text' | 'place'> {
      if (!text || (isInsert && !base) || (ruby && text === initialText)) {
        return 'dismissed';
      }
      if (!isWritableRubyText(text)) {
        return { invalid: 'text' };
      }
      const applied = isInsert
        ? editor.commands.insertRuby({ base, rubyText: text })
        : editor.commands.setRuby(text);
      return applied ? 'applied' : { invalid: 'place' };
    },
    remove(): void {
      editor.commands.unsetRuby();
    },
  };
}

export function openMathForm(editor: Editor) {
  const math = selectedNodeOf(editor.state, 'math');
  const initial = {
    latex: String(math?.attrs.latex ?? ''),
    display: Boolean(math?.attrs.display),
  };
  return {
    initial,
    apply({
      latex,
      display = initial.display,
    }: {
      latex: string;
      display?: boolean;
    }): FormOutcome<'source'> {
      if (
        !latex ||
        (math && latex === initial.latex && display === initial.display)
      ) {
        return 'dismissed';
      }
      if (
        !isMathSource(editor, latex, display) ||
        !editor.commands.setMath({ latex, display })
      ) {
        return { invalid: 'source' };
      }
      return 'applied';
    },
  };
}

export function openFootnoteForm(editor: Editor) {
  return {
    apply({ text }: { text: string }): FormOutcome {
      if (!text) {
        return 'dismissed';
      }
      editor.commands.setInlineFootnote(text);
      return 'applied';
    },
  };
}

export function openFootnoteReferenceForm(editor: Editor) {
  const reference = selectedNodeOf(editor.state, 'footnoteReference');
  const initialLabel = reference
    ? String(reference.attrs.label ?? '')
    : nextFootnoteLabel(editor.state.doc);
  return {
    initialLabel,
    apply({ label = initialLabel }: { label?: string }): FormOutcome<'label'> {
      if (reference && label === initialLabel) {
        return 'dismissed';
      }
      if (
        !isWritableFootnoteLabel(label) ||
        !editor.commands.setFootnoteReference(label)
      ) {
        return { invalid: 'label' };
      }
      return 'applied';
    },
  };
}

export function openLinkForm(editor: Editor) {
  // With nothing selected there is no text to link, so the form inserts one.
  const isInsert = editor.state.selection.empty;
  const initialHref = getSelectedLinkHref(editor.state) ?? '';
  // null hides the text field for selections that can't be retyped as one
  // string, such as ones spanning paragraphs or containing hard breaks.
  const initialText = isInsert ? '' : getEditableSelectionText(editor.state);
  const hasLink = selectionHasLink(editor.state);
  const remove = () => removeLinkFromSelection(editor);
  return {
    isInsert,
    initialHref,
    initialText,
    hasLink,
    apply({
      href: field,
      text = initialText ?? undefined,
    }: {
      href: string;
      text?: string;
    }): FormOutcome<'url'> {
      const href = field.trim();
      if (!href) {
        if (!hasLink) {
          return 'dismissed';
        }
        remove();
        return 'applied';
      }
      const applied = isInsert
        ? insertLink(editor, { href, text })
        : setLinkOnSelection(editor, {
            href,
            // Left alone, the field holds the text from when the form
            // opened, which a collaborator may have edited since.
            text: text === initialText ? undefined : text,
          });
      return applied ? 'applied' : { invalid: 'url' };
    },
    remove,
  };
}

/** The attributes as typed in the form, without their braces. */
function attributesText(attributes: unknown): string {
  if (!attributes || typeof attributes !== 'object') {
    return '';
  }
  return (formatAttributes(attributes as InlineAttributes) ?? '{}').slice(
    1,
    -1,
  );
}

export function openAttributesForm(editor: Editor) {
  const target = attributedMarkOf(editor.state);
  const initialText = attributesText(target?.mark.attrs.attributes);
  return {
    initialText,
    apply({ text: field }: { text: string }): FormOutcome<'attributes'> {
      const text = field.trim();
      if (!target || text === initialText) {
        return 'dismissed';
      }
      const attributes = text ? parseAttributes(`{${text}}`) : null;
      if (
        (text && !attributes) ||
        !setMarkAttributes(editor, target, attributes)
      ) {
        return { invalid: 'attributes' };
      }
      return 'applied';
    },
  };
}
