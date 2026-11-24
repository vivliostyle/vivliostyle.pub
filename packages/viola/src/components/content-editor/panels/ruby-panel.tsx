import { useRef, useState } from 'react';

import { isWritableRubyText } from '@v/tiptap-extensions';
import { RemoveFormattingIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { selectedRuby } from '../../../libs/editor/vfm';
import { dismissPanel, PanelButton, PanelForm } from './panel-form';

export function RubyPanel({ editor, close }: EditorMenuPanelProps) {
  const baseRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const [ruby] = useState(() => selectedRuby(editor.state));
  // With nothing selected there is no base, so the panel asks for one.
  const [isInsert] = useState(() => !ruby && editor.state.selection.empty);
  const [initialText] = useState(() =>
    ruby ? String(ruby.attrs.rubyText ?? '') : '',
  );
  const [invalid, setInvalid] = useState<'text' | 'place' | null>(null);

  const apply = () => {
    const text = textRef.current?.value ?? '';
    const base = baseRef.current?.value ?? '';
    if (!text || (isInsert && !base) || (ruby && text === initialText)) {
      dismissPanel({ editor, close });
      return;
    }
    if (!isWritableRubyText(text)) {
      setInvalid('text');
      return;
    }
    const applied = isInsert
      ? editor.chain().focus().insertRuby({ base, rubyText: text }).run()
      : editor.chain().focus().setRuby(text).run();
    if (!applied) {
      setInvalid('place');
      return;
    }
    close();
  };

  const remove = () => {
    editor.chain().focus().unsetRuby().run();
    close();
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={isInsert ? baseRef : textRef}
      submitLabel={m.ruby_panel_apply_aria()}
      onSubmit={apply}
      actions={
        ruby && (
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
