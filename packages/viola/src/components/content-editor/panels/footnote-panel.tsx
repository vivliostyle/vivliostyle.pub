import { useRef, useState } from 'react';

import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import {
  openFootnoteForm,
  openFootnoteReferenceForm,
} from '../../../libs/editor/menu/forms';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { PanelForm, settlePanel } from './panel-form';

/** Inserts a note where it is written. */
export function FootnotePanel({ editor, close }: EditorMenuPanelProps) {
  const textRef = useRef<HTMLInputElement>(null);
  const [panel] = useState(() => openFootnoteForm(editor));

  const apply = () => {
    const outcome = panel.apply({ text: textRef.current?.value ?? '' });
    settlePanel({ editor, close }, outcome, () => {});
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
  const [panel] = useState(() => openFootnoteReferenceForm(editor));
  const { initialLabel } = panel;
  const [invalid, setInvalid] = useState(false);

  const apply = () => {
    const outcome = panel.apply({ label: labelRef.current?.value ?? '' });
    settlePanel({ editor, close }, outcome, () => setInvalid(true));
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
