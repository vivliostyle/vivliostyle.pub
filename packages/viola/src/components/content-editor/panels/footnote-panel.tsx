import { useRef, useState } from 'react';

import { isWritableFootnoteLabel } from '@v/tiptap-extensions';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import {
  hasFootnoteDefinition,
  nextFootnoteLabel,
  selectedNodeOf,
} from '../../../libs/editor/vfm';
import { dismissPanel, PanelForm } from './panel-form';

/** Inserts a note where it is written. */
export function FootnotePanel({ editor, close }: EditorMenuPanelProps) {
  const textRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const text = textRef.current?.value ?? '';
    if (!text) {
      dismissPanel({ editor, close });
      return;
    }
    editor.chain().focus().setInlineFootnote(text).run();
    close();
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={textRef}
      submitLabel={m.footnote_panel_apply_aria()}
      onSubmit={apply}
    >
      <Input
        ref={textRef}
        placeholder={m.footnote_panel_text_placeholder()}
        aria-label={m.footnote_panel_text_aria()}
        className="h-7 w-72"
      />
    </PanelForm>
  );
}

/**
 * Inserts a reference to a note, with its definition at the end of the
 * document when it has none, or changes the label of a reference.
 */
export function FootnoteReferencePanel({
  editor,
  close,
}: EditorMenuPanelProps) {
  const labelRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const [reference] = useState(() =>
    selectedNodeOf(editor.state, 'footnoteReference'),
  );
  const [initialLabel] = useState(() =>
    reference
      ? String(reference.attrs.label ?? '')
      : nextFootnoteLabel(editor.state.doc),
  );
  const [invalid, setInvalid] = useState(false);
  // Only a new reference gets a definition with it, where the document can
  // hold one.
  const [definable] = useState(
    () =>
      !reference && editor.can().insertFootnoteDefinition(initialLabel, 'x'),
  );

  const apply = () => {
    const label = labelRef.current?.value ?? '';
    if (reference && label === initialLabel) {
      dismissPanel({ editor, close });
      return;
    }
    if (!isWritableFootnoteLabel(label)) {
      setInvalid(true);
      return;
    }
    const chain = editor.chain().focus().setFootnoteReference(label);
    if (definable && !hasFootnoteDefinition(editor.state.doc, label)) {
      chain.insertFootnoteDefinition(label, textRef.current?.value.trim());
    }
    if (!chain.run()) {
      setInvalid(true);
      return;
    }
    close();
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={labelRef}
      submitLabel={m.footnote_panel_apply_reference_aria()}
      onSubmit={apply}
      error={invalid && m.footnote_panel_invalid_label()}
    >
      <Input
        ref={labelRef}
        defaultValue={initialLabel}
        placeholder={m.footnote_panel_label_placeholder()}
        aria-label={m.footnote_panel_label_aria()}
        aria-invalid={invalid}
        className="h-7 w-40"
        onChange={() => setInvalid(false)}
      />
      {definable && (
        <Input
          ref={textRef}
          placeholder={m.footnote_panel_definition_placeholder()}
          aria-label={m.footnote_panel_definition_aria()}
          className="h-7 w-64"
        />
      )}
    </PanelForm>
  );
}
