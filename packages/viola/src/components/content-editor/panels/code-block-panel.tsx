import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react-dom';
import type React from 'react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  findSelectedCodeBlock,
  listHighlightLanguages,
} from '@v/tiptap-extensions';
import { Input } from '@v/ui/input';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../../generated/paraglide/messages';
import {
  languageRange,
  replaceLanguage,
  suggestLanguages,
} from '../../../libs/editor/code-block-language';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { scrollOptionIntoView } from '../../../libs/scroll-option-into-view';
import { PanelForm } from './panel-form';

type ListMode = 'closed' | 'typing' | 'browsing';

export function CodeBlockPanel({ editor, close }: EditorMenuPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const languages = useMemo(listHighlightLanguages, []);
  const [value, setValue] = useState<string>(
    () => findSelectedCodeBlock(editor.state)?.node.attrs.language ?? '',
  );
  // Selecting just the language lets typing replace it while the meta stays.
  const [initialSelection] = useState(() => languageRange(value));
  const [caret, setCaret] = useState(initialSelection.from);
  const [listMode, setListMode] = useState<ListMode>('closed');
  const [activeIndex, setActiveIndex] = useState(-1);
  const pendingCaretRef = useRef<number | null>(null);

  const suggestions =
    listMode === 'closed'
      ? []
      : suggestLanguages(languages, value, caret, {
          browse: listMode === 'browsing',
        });
  const expanded = suggestions.length > 0;

  const { refs, floatingStyles } = useFloating({
    open: expanded,
    placement: 'bottom-start',
    strategy: 'absolute',
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          // Overrides max-h-48, which still caps the list when flip() first
          // measures it.
          elements.floating.style.maxHeight = `min(12rem, ${Math.max(availableHeight, 0)}px)`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    refs.setReference(inputRef.current);
  }, [refs]);

  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (pending !== null) {
      pendingCaretRef.current = null;
      inputRef.current?.setSelectionRange(pending, pending);
      setCaret(pending);
    }
  });

  useEffect(() => {
    const listbox = refs.floating.current;
    const option = listbox?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (activeIndex >= 0 && listbox && option) {
      scrollOptionIntoView(listbox, option);
    }
  }, [activeIndex, refs]);

  const updateCaret = () => {
    setCaret(inputRef.current?.selectionStart ?? 0);
  };

  const closeList = () => {
    setListMode('closed');
    setActiveIndex(-1);
  };

  const pick = (language: string) => {
    const next = replaceLanguage(value, language);
    setValue(next.infoString);
    pendingCaretRef.current = next.caret;
    closeList();
  };

  const apply = () => {
    editor.chain().focus().setCodeBlockInfo(value).run();
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const active = suggestions[activeIndex];
    switch (event.key) {
      case 'ArrowDown':
        if (expanded) {
          event.preventDefault();
          setActiveIndex((activeIndex + 1) % suggestions.length);
        } else if (
          suggestLanguages(languages, value, caret, { browse: true }).length
        ) {
          event.preventDefault();
          setListMode('browsing');
          setActiveIndex(0);
        }
        return;
      case 'ArrowUp':
        if (expanded) {
          event.preventDefault();
          setActiveIndex(
            (activeIndex <= 0 ? suggestions.length : activeIndex) - 1,
          );
        }
        return;
      case 'Enter':
      case 'Tab':
        if (active !== undefined) {
          event.preventDefault();
          pick(active);
        }
        return;
      case 'Escape':
        if (expanded) {
          event.preventDefault();
          event.stopPropagation();
          closeList();
        }
        return;
    }
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={inputRef}
      initialSelection={initialSelection}
      submitLabel={m.code_block_panel_apply_aria()}
      onSubmit={apply}
    >
      <div>
        <Input
          ref={inputRef}
          value={value}
          role="combobox"
          aria-label={m.code_block_panel_info_aria()}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listboxId : undefined}
          aria-activedescendant={
            expanded && activeIndex >= 0
              ? `${listboxId}-${activeIndex}`
              : undefined
          }
          placeholder={m.code_block_panel_info_placeholder()}
          autoComplete="off"
          spellCheck={false}
          className="h-7 w-80 font-mono"
          onChange={(event) => {
            setValue(event.target.value);
            setListMode('typing');
            setActiveIndex(-1);
            updateCaret();
          }}
          onSelect={updateCaret}
          onBlur={closeList}
          onKeyDown={handleKeyDown}
        />
        {expanded && (
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            id={listboxId}
            role="listbox"
            aria-label={m.code_block_panel_suggestions_aria()}
            className="z-10 max-h-48 min-w-40 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            // Keeps focus, and so the caret, in the field while picking.
            onMouseDown={(event) => event.preventDefault()}
          >
            {suggestions.map((language, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the field keeps focus and drives the keyboard
              <div
                key={language}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                className={cn(
                  'cursor-default rounded-sm px-2 py-1 font-mono text-sm',
                  index === activeIndex && 'bg-accent text-accent-foreground',
                )}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => pick(language)}
              >
                {language}
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelForm>
  );
}
