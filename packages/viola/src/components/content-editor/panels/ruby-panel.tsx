import { useRef, useState } from 'react';

import { RemoveFormattingIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import { openRubyForm } from '../../../libs/editor/menu/forms';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import {
  dismissPanel,
  PanelButton,
  PanelForm,
  settlePanel,
} from './panel-form';

export function RubyPanel({ editor, close }: EditorMenuPanelProps) {
  const baseRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const [panel] = useState(() => openRubyForm(editor));
  const { hasRuby, isInsert, initialText } = panel;
  const [invalid, setInvalid] = useState<'text' | 'place' | null>(null);

  const apply = () => {
    const outcome = panel.apply({
      base: baseRef.current?.value,
      text: textRef.current?.value ?? '',
    });
    settlePanel({ editor, close }, outcome, setInvalid);
  };

  const remove = () => {
    panel.remove();
    dismissPanel({ editor, close });
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={isInsert ? baseRef : textRef}
      submitLabel={m.ruby_panel_apply_aria()}
      onSubmit={apply}
      actions={
        hasRuby && (
          <PanelButton label={m.ruby_panel_remove_aria()} onClick={remove}>
            <RemoveFormattingIcon />
          </PanelButton>
        )
      }
      error={
        invalid === 'text'
          ? m.ruby_panel_invalid_text()
          : invalid === 'place' && m.ruby_panel_unwritable()
      }
    >
      <div className="flex flex-col gap-1">
        {isInsert && (
          <Input
            ref={baseRef}
            placeholder={m.ruby_panel_base_placeholder()}
            aria-label={m.ruby_panel_base_aria()}
            className="h-7 w-56"
          />
        )}
        <Input
          ref={textRef}
          defaultValue={initialText}
          placeholder={m.ruby_panel_text_placeholder()}
          aria-label={m.ruby_panel_text_aria()}
          aria-invalid={invalid === 'text'}
          className="h-7 w-56"
          onChange={() => setInvalid(null)}
        />
      </div>
    </PanelForm>
  );
}
