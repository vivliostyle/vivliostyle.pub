import { useRef, useState } from 'react';

import { UnlinkIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import {
  getEditableSelectionText,
  getSelectedLinkHref,
  insertLink,
  removeLinkFromSelection,
  selectionHasLink,
  setLinkOnSelection,
} from '../../../libs/editor/link';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { dismissPanel, PanelButton, PanelForm } from './panel-form';

export function LinkPanel({ editor, close }: EditorMenuPanelProps) {
  const urlRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  // With nothing selected there is no text to link, so the panel inserts one.
  const [isInsert] = useState(() => editor.state.selection.empty);
  const [initialHref] = useState(() => getSelectedLinkHref(editor.state) ?? '');
  // null hides the text field for selections that can't be retyped as one
  // string, such as ones spanning paragraphs or containing hard breaks.
  const [initialText] = useState(() =>
    isInsert ? '' : getEditableSelectionText(editor.state),
  );
  const [hasLink] = useState(() => selectionHasLink(editor.state));
  const [invalid, setInvalid] = useState(false);

  const removeLink = () => {
    removeLinkFromSelection(editor);
    close();
  };

  const apply = () => {
    const href = urlRef.current?.value.trim() ?? '';
    if (!href) {
      if (hasLink) {
        removeLink();
      } else {
        dismissPanel({ editor, close });
      }
      return;
    }
    const text = textRef.current?.value;
    const applied = isInsert
      ? insertLink(editor, { href, text })
      : setLinkOnSelection(editor, {
          href,
          // Left alone, the field holds the text from when the panel opened,
          // which a collaborator may have edited since.
          text: text === initialText ? undefined : text,
        });
    if (!applied) {
      setInvalid(true);
      return;
    }
    close();
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
