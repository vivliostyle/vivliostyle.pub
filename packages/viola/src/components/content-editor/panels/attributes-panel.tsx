import { useRef, useState } from 'react';

import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import { openAttributesForm } from '../../../libs/editor/menu/forms';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { PanelForm, settlePanel } from './panel-form';

export function AttributesPanel({ editor, close }: EditorMenuPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [panel] = useState(() => openAttributesForm(editor));
  const { initialText } = panel;
  const [invalid, setInvalid] = useState(false);

  const apply = () => {
    const outcome = panel.apply({ text: inputRef.current?.value ?? '' });
    settlePanel({ editor, close }, outcome, () => setInvalid(true));
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={inputRef}
      submitLabel={m.attributes_panel_apply_aria()}
      onSubmit={apply}
      error={invalid && m.attributes_panel_invalid()}
    >
      <Input
        ref={inputRef}
        defaultValue={initialText}
        placeholder={m.attributes_panel_placeholder()}
        aria-label={m.attributes_panel_input_aria()}
        aria-invalid={invalid}
        spellCheck={false}
        autoComplete="off"
        className="h-7 w-64 font-mono"
        onChange={() => setInvalid(false)}
      />
    </PanelForm>
  );
}
