import { useRef, useState } from 'react';

import { isWritableFootnoteLabel } from '@v/tiptap-extensions';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { nextFootnoteLabel, selectedNodeOf } from '../../../libs/editor/vfm';
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

/** Inserts a reference to a note defined elsewhere, or changes its label. */
export function FootnoteReferencePanel({
  editor,
  close,
}: EditorMenuPanelProps) {
  const labelRef = useRef<HTMLInputElement>(null);
  const [reference] = useState(() =>
    selectedNodeOf(editor.state, 'footnoteReference'),
  );
  const [initialLabel] = useState(() =>
    reference
      ? String(reference.attrs.label ?? '')
      : nextFootnoteLabel(editor.state.doc),
  );
  const [invalid, setInvalid] = useState(false);

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
    if (!editor.chain().focus().setFootnoteReference(label).run()) {
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
    </PanelForm>
  );
}
