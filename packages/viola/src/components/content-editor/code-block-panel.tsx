import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  findSelectedCodeBlock,
  getCodeBlockInfo,
  listHighlightLanguages,
} from '@v/tiptap-extensions';
import { Button } from '@v/ui/button';
import { CheckIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { m } from '../../generated/paraglide/messages';
import type { EditorMenuPanelProps } from '../../libs/editor/menu/types';

export function CodeBlockPanel({ editor, close }: EditorMenuPanelProps) {
  const languageRef = useRef<HTMLInputElement>(null);
  const metaRef = useRef<HTMLInputElement>(null);
  const languageListId = useId();
  const languages = useMemo(listHighlightLanguages, []);
  const [initial] = useState(() => {
    const block = findSelectedCodeBlock(editor.state);
    return block
      ? getCodeBlockInfo(block.node)
      : { language: null, meta: null };
  });

  useEffect(() => {
    languageRef.current?.focus();
    languageRef.current?.select();
  }, []);

  const apply = () => {
    editor
      .chain()
      .focus()
      .setCodeBlockInfo({
        language: languageRef.current?.value ?? null,
        meta: metaRef.current?.value ?? null,
      })
      .run();
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
    <form
      className="flex items-start gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <div className="flex flex-col gap-1">
        <Input
          ref={languageRef}
          defaultValue={initial.language ?? ''}
          placeholder={m.code_block_panel_language_placeholder()}
          aria-label={m.code_block_panel_language_aria()}
          list={languageListId}
          autoComplete="off"
          spellCheck={false}
          className="h-7 w-64"
          onKeyDown={handleKeyDown}
        />
        <datalist id={languageListId}>
          {languages.map((language) => (
            <option key={language} value={language} />
          ))}
        </datalist>
        <Input
          ref={metaRef}
          defaultValue={initial.meta ?? ''}
          placeholder={m.code_block_panel_meta_placeholder()}
          aria-label={m.code_block_panel_meta_aria()}
          autoComplete="off"
          spellCheck={false}
          className="h-7 w-64"
          onKeyDown={handleKeyDown}
        />
      </div>
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label={m.code_block_panel_apply_aria()}
        title={m.code_block_panel_apply_aria()}
      >
        <CheckIcon />
      </Button>
    </form>
  );
}
