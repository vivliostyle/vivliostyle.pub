import { useRef, useState } from 'react';

import { UnlinkIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import { openLinkForm } from '../../../libs/editor/menu/forms';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import {
  dismissPanel,
  PanelButton,
  PanelForm,
  settlePanel,
} from './panel-form';

export function LinkPanel({ editor, close }: EditorMenuPanelProps) {
  const urlRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const [panel] = useState(() => openLinkForm(editor));
  const { initialHref, initialText, hasLink } = panel;
  const [invalid, setInvalid] = useState(false);

  const removeLink = () => {
    panel.remove();
    dismissPanel({ editor, close });
  };

  const apply = () => {
    const outcome = panel.apply({
      href: urlRef.current?.value ?? '',
      text: textRef.current?.value,
    });
    settlePanel({ editor, close }, outcome, () => setInvalid(true));
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={urlRef}
      submitLabel={m.link_panel_apply_aria()}
      onSubmit={apply}
      actions={
        hasLink && (
          <PanelButton label={m.link_panel_remove_aria()} onClick={removeLink}>
            <UnlinkIcon />
          </PanelButton>
        )
      }
      error={invalid && m.link_panel_invalid_url()}
    >
      <div className="flex flex-col gap-1">
        <Input
          ref={urlRef}
          defaultValue={initialHref}
          placeholder={m.link_panel_url_placeholder()}
          aria-label={m.link_panel_url_aria()}
          aria-invalid={invalid}
          className="h-7 w-64"
          onChange={() => setInvalid(false)}
        />
        {initialText !== null && (
          <Input
            ref={textRef}
            defaultValue={initialText}
            placeholder={m.link_panel_text_placeholder()}
            aria-label={m.link_panel_text_aria()}
            className="h-7 w-64"
          />
        )}
      </div>
    </PanelForm>
  );
}
