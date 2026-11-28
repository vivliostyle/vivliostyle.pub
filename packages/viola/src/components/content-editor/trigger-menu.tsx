import {
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react-dom';
import { useCurrentEditor } from '@tiptap/react';
import {
  type ComponentType,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSnapshot } from 'valtio';

import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import {
  editorMenuConfig,
  flattenCommands,
  resolveMenuEntries,
} from '../../libs/editor/menu/config';
import { filterMenuEntries } from '../../libs/editor/menu/filter';
import {
  executeTriggerCommand,
  setTriggerMenuKeyHandler,
  triggerMenuState,
} from '../../libs/editor/menu/trigger-state';
import type {
  EditorMenuCommand,
  EditorMenuPanelProps,
} from '../../libs/editor/menu/types';
import { scrollOptionIntoView } from '../../libs/scroll-option-into-view';
import { CaretPopover } from './panels/caret-popover';

export function TriggerMenu() {
  const { editor } = useCurrentEditor();
  const stateSnap = useSnapshot(triggerMenuState);
  const configSnap = useSnapshot(editorMenuConfig);
  const session =
    editor && stateSnap.session?.editor === editor ? stateSnap.session : null;
  const menuId = session?.menuId;
  const query = session?.query ?? '';
  const openId = session?.openId;
  const clientRect = session?.clientRect;

  const entries = useMemo(() => {
    const menu = configSnap.triggers.find((t) => t.id === menuId);
    return menu ? resolveMenuEntries(menu.items, 'trigger') : [];
  }, [configSnap.triggers, menuId]);
  const filtered = useMemo(
    () => filterMenuEntries(entries, query),
    [entries, query],
  );
  const commands = useMemo(() => flattenCommands(filtered), [filtered]);
  const visible = session !== null && commands.length > 0;

  const [activeIndex, setActiveIndex] = useState(0);
  const currentIndex = Math.min(activeIndex, commands.length - 1);
  const activeCommand = commands[currentIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [openId, query]);

  const { refs, floatingStyles, middlewareData, isPositioned, update } =
    useFloating({
      open: visible,
      placement: 'bottom-start',
      strategy: 'absolute',
      middleware: [
        offset(4),
        flip({ padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply({ availableHeight, elements }) {
            elements.floating.style.maxHeight = `${Math.max(availableHeight, 96)}px`;
          },
        }),
        hide(),
      ],
      whileElementsMounted: autoUpdate,
    });

  useLayoutEffect(() => {
    if (!editor || !clientRect) {
      refs.setReference(null);
      return;
    }
    refs.setReference({
      getBoundingClientRect: () => clientRect() ?? new DOMRect(),
      // Lets autoUpdate find the scroll containers around the editor.
      contextElement: editor.view.dom,
    });
  }, [editor, clientRect, refs]);

  // autoUpdate misses a remote edit that moves the trigger along its line, as
  // no element moves or resizes.
  useEffect(() => {
    if (!editor || !visible) {
      return;
    }
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor, visible, update]);

  // middlewareData outlives a close, so only trust it once this open has been
  // positioned.
  const referenceHidden =
    isPositioned && middlewareData.hide?.referenceHidden === true;
  useEffect(() => {
    if (visible && referenceHidden) {
      editor?.commands.closeTriggerMenu();
    }
  }, [editor, visible, referenceHidden]);

  const [Panel, setPanel] =
    useState<ComponentType<EditorMenuPanelProps> | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);

  const execute = useCallback(
    (command: EditorMenuCommand) => {
      if (!editor) {
        return;
      }
      const panel = executeTriggerCommand(editor, command);
      if (panel) {
        setPanel(() => panel);
      }
    },
    [editor],
  );

  const latest = useRef({ visible, commands, currentIndex });
  latest.current = { visible, commands, currentIndex };

  useEffect(() => {
    if (!editor) {
      return;
    }
    setTriggerMenuKeyHandler(editor, (event) => {
      const { visible, commands, currentIndex } = latest.current;
      if (event.isComposing || event.keyCode === 229) {
        return false;
      }
      if (event.key === 'Escape') {
        editor.commands.closeTriggerMenu();
        return visible;
      }
      if (
        !visible ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return false;
      }
      const count = commands.length;
      switch (event.key) {
        case 'ArrowDown':
          // Functional updates so key repeat outpacing renders still advances.
          setActiveIndex((index) => (Math.min(index, count - 1) + 1) % count);
          return true;
        case 'ArrowUp':
          setActiveIndex(
            (index) => (Math.min(index, count - 1) - 1 + count) % count,
          );
          return true;
        case 'Enter':
        case 'Tab': {
          const command = commands[currentIndex];
          if (command) {
            execute(command);
          }
          return true;
        }
        default:
          return false;
      }
    });
    return () => setTriggerMenuKeyHandler(editor, null);
  }, [editor, execute]);

  const optionRefs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const listbox = refs.floating.current;
    const option = optionRefs.current[currentIndex];
    if (listbox && option) {
      scrollOptionIntoView(listbox, option);
    }
  }, [currentIndex, refs]);

  let optionIndex = 0;
  const renderOption = (command: EditorMenuCommand) => {
    const index = optionIndex++;
    const Icon = command.icon;
    const enabled = !editor || (command.isEnabled?.(editor) ?? true);
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: focus stays in the editor, whose plugin drives the keyboard
      <div
        key={index}
        ref={(el) => {
          optionRefs.current[index] = el;
        }}
        role="option"
        aria-selected={index === currentIndex}
        aria-disabled={!enabled}
        tabIndex={-1}
        className={cn(
          'flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
          index === currentIndex && 'bg-accent text-accent-foreground',
          !enabled && 'opacity-50',
        )}
        // mousemove rather than mouseenter: the menu often opens under a
        // resting pointer, which must not steal the highlight.
        onMouseMove={() => setActiveIndex(index)}
        onClick={() => execute(command)}
      >
        {Icon && <Icon className="size-4 shrink-0" />}
        <span className="truncate">{command.label()}</span>
      </div>
    );
  };

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {visible && activeCommand ? activeCommand.label() : ''}
      </div>
      {editor && Panel && (
        <CaretPopover editor={editor} onDismiss={closePanel}>
          <Panel editor={editor} close={closePanel} />
        </CaretPopover>
      )}
      {visible && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          role="listbox"
          aria-label={m.trigger_menu_listbox_aria()}
          tabIndex={-1}
          className="z-50 min-w-48 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          // Keeps focus (and the IME) in the editor while clicking options.
          onMouseDown={(event) => event.preventDefault()}
        >
          {filtered.map((entry, entryIndex) => {
            switch (entry.type) {
              case 'separator':
                return (
                  <hr
                    key={`separator-${entryIndex}`}
                    className="-mx-1 my-1 h-px border-0 bg-border"
                  />
                );
              case 'command':
                return renderOption(entry.command);
              default:
                return (
                  // biome-ignore lint/a11y/useSemanticElements: an ARIA group of options; fieldset is for form controls
                  <div
                    key={`group-${entryIndex}`}
                    role="group"
                    aria-label={entry.label()}
                  >
                    <div
                      aria-hidden
                      className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground"
                    >
                      {entry.label()}
                    </div>
                    {entry.commands.map(renderOption)}
                  </div>
                );
            }
          })}
        </div>
      )}
    </>
  );
}
