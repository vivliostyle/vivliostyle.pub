import { useRef, useState } from 'react';

import {
  formatAttributes,
  type InlineAttributes,
  parseAttributes,
} from '@v/tiptap-extensions';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { attributedMarkOf, setMarkAttributes } from '../../../libs/editor/vfm';
import { dismissPanel, PanelForm } from './panel-form';

/** The attributes as typed in the panel, without their braces. */
function attributesText(attributes: unknown): string {
  if (!attributes || typeof attributes !== 'object') {
    return '';
  }
  return (formatAttributes(attributes as InlineAttributes) ?? '{}').slice(
    1,
    -1,
  );
}

export function AttributesPanel({ editor, close }: EditorMenuPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [target] = useState(() => attributedMarkOf(editor.state));
  const [initialText] = useState(() =>
    attributesText(target?.mark.attrs.attributes),
  );
  const [invalid, setInvalid] = useState(false);

  const apply = () => {
    const text = inputRef.current?.value.trim() ?? '';
    if (!target || text === initialText) {
      dismissPanel({ editor, close });
      return;
    }
    const attributes = text ? parseAttributes(`{${text}}`) : null;
    if (
      (text && !attributes) ||
      !setMarkAttributes(editor, target, attributes)
    ) {
      setInvalid(true);
      return;
    }
    close();
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
