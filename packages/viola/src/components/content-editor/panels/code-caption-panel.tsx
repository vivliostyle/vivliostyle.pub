import { useRef, useState } from 'react';

import {
  codeBlockAttributes,
  codeBlockCaption,
  findSelectedCodeBlock,
} from '@v/tiptap-extensions';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { dismissPanel, PanelForm } from './panel-form';

/** The caption VFM puts above the code block, kept in its info string. */
export function CodeCaptionPanel({ editor, close }: EditorMenuPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [info] = useState(
    () => findSelectedCodeBlock(editor.state)?.node.attrs.language,
  );
  const attributes = codeBlockAttributes(info);
  const initialCaption = codeBlockCaption(info, attributes) ?? '';
  // A title in the attributes wins, and is edited there.
  const inAttributes = typeof attributes?.title === 'string';
  const [invalid, setInvalid] = useState(false);

  const apply = () => {
    const caption = inputRef.current?.value.trim() ?? '';
    if (caption === initialCaption) {
      dismissPanel({ editor, close });
      return;
    }
    if (!editor.chain().focus().setCodeBlockCaption(caption).run()) {
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
      submitLabel={m.code_caption_panel_apply_aria()}
      onSubmit={apply}
      error={
        invalid &&
        (inAttributes
          ? m.code_caption_panel_in_attributes()
          : m.code_caption_panel_invalid())
      }
    >
      <Input
        ref={inputRef}
        defaultValue={initialCaption}
        placeholder={m.code_caption_panel_placeholder()}
        aria-label={m.code_caption_panel_input_aria()}
        aria-invalid={invalid}
        autoComplete="off"
        className="h-7 w-64"
        onChange={() => setInvalid(false)}
      />
    </PanelForm>
  );
}
