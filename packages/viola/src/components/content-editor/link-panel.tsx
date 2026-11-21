import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@v/ui/button';
import { CheckIcon, UnlinkIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { m } from '../../generated/paraglide/messages';
import {
  getEditableSelectionText,
  getSelectedLinkHref,
  insertLink,
  removeLinkFromSelection,
  selectionHasLink,
  setLinkOnSelection,
} from '../../libs/editor/link';
import type { EditorMenuPanelProps } from '../../libs/editor/menu/types';

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

  useEffect(() => {
    // The panel can mount before its popover is positioned, when scrolling to
    // the field would jump the editor pane.
    urlRef.current?.focus({ preventScroll: true });
    urlRef.current?.select();
  }, []);

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
        close();
        editor.commands.focus();
      }
      return;
    }
    const text = textRef.current?.value;
    const applied = isInsert
      ? insertLink(editor, { href, text })
      : setLinkOnSelection(editor, { href, text });
    if (!applied) {
      setInvalid(true);
      return;
    }
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    close();
    editor.commands.focus();
  };

  return (
    <div className="flex flex-col gap-1">
      <form
        className="flex items-start gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
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
            onKeyDown={handleKeyDown}
          />
          {initialText !== null && (
            <Input
              ref={textRef}
              defaultValue={initialText}
              placeholder={m.link_panel_text_placeholder()}
              aria-label={m.link_panel_text_aria()}
              className="h-7 w-64"
              onKeyDown={handleKeyDown}
            />
          )}
        </div>
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={m.link_panel_apply_aria()}
          title={m.link_panel_apply_aria()}
        >
          <CheckIcon />
        </Button>
        {hasLink && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={m.link_panel_remove_aria()}
            title={m.link_panel_remove_aria()}
            onClick={removeLink}
          >
            <UnlinkIcon />
          </Button>
        )}
      </form>
      {invalid && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {m.link_panel_invalid_url()}
        </p>
      )}
    </div>
  );
}
