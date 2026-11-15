import type { Editor } from '@tiptap/core';
import type { EditorState, Selection } from '@tiptap/pm/state';
import { AllSelection, PluginKey, TextSelection } from '@tiptap/pm/state';
import { useCurrentEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus';
import type React from 'react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@v/ui/dropdown';
import { CheckIcon, ChevronDownIcon } from '@v/ui/icon';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import {
  editorMenuConfig,
  resolveMenuEntries,
} from '../../libs/editor/menu/config';
import { runEditorMenuCommand } from '../../libs/editor/menu/registry';
import { formatShortcut } from '../../libs/editor/menu/shortcut';
import { triggerMenuState } from '../../libs/editor/menu/trigger-state';
import type {
  EditorMenuCommand,
  ResolvedMenuEntry,
  ResolvedMenuGroup,
} from '../../libs/editor/menu/types';

const selectionToolbarPluginKey = new PluginKey('selectionToolbar');

type ShouldShow = NonNullable<BubbleMenuProps['shouldShow']>;

function hasTextSelection(state: EditorState): boolean {
  const { selection } = state;
  if (
    selection.empty ||
    !(selection instanceof TextSelection || selection instanceof AllSelection)
  ) {
    return false;
  }
  return state.doc.textBetween(selection.from, selection.to).length > 0;
}

function commandTitle(command: EditorMenuCommand): string {
  const label = command.label();
  return command.shortcut
    ? `${label} (${formatShortcut(command.shortcut)})`
    : label;
}

interface SelectionToolbarProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function SelectionToolbar({ containerRef }: SelectionToolbarProps) {
  const { editor } = useCurrentEditor();
  const configSnap = useSnapshot(editorMenuConfig);
  const entries = useMemo(
    () =>
      configSnap.selection.enabled
        ? resolveMenuEntries(configSnap.selection.items, 'selection')
        : [],
    [configSnap.selection],
  );
  const [panel, setPanel] = useState<EditorMenuCommand | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(false);
  const pointerDownRef = useRef(false);
  const dismissedRef = useRef<Selection | null>(null);

  // Re-render on every transaction so active/enabled states stay current.
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  });

  const canShow = useCallback(
    (target: Editor, state: EditorState, hasFocus: boolean) => {
      if (
        !target.isEditable ||
        !hasFocus ||
        pointerDownRef.current ||
        triggerMenuState.session?.editor === target ||
        !hasTextSelection(state)
      ) {
        return false;
      }
      const dismissed = dismissedRef.current;
      if (dismissed) {
        if (dismissed.eq(state.selection)) {
          return false;
        }
        dismissedRef.current = null;
      }
      return true;
    },
    [],
  );

  const shouldShow = useCallback<ShouldShow>(
    ({ editor: target, view, state, element }) =>
      canShow(
        target,
        state,
        view.hasFocus() || element.contains(document.activeElement),
      ),
    [canShow],
  );

  const appendTo = useCallback(
    () => containerRef.current ?? document.body,
    [containerRef],
  );

  const options = useMemo<BubbleMenuProps['options']>(
    () => ({
      // On touch devices the native selection callout sits above the text.
      placement: window.matchMedia('(pointer: coarse)').matches
        ? 'bottom'
        : 'top',
      offset: 8,
      flip: { padding: 8 },
      shift: { padding: 8 },
      onShow: () => {
        visibleRef.current = true;
        setFocusIndex(0);
      },
      onHide: () => {
        visibleRef.current = false;
        setPanel(null);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!editor) {
      return;
    }
    const dom = editor.view.dom;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) {
        pointerDownRef.current = true;
      }
    };
    // While dragging, shouldShow keeps the toolbar hidden; once the button is
    // released nothing else changes the selection, so show it explicitly.
    const handleMouseUp = () => {
      if (!pointerDownRef.current) {
        return;
      }
      pointerDownRef.current = false;
      setTimeout(() => {
        if (
          editor.isDestroyed ||
          !canShow(editor, editor.state, editor.view.hasFocus())
        ) {
          return;
        }
        editor.view.dispatch(
          editor.state.tr.setMeta(selectionToolbarPluginKey, 'show'),
        );
        // BubbleMenu skips positioning while it is still hidden.
        editor.view.dispatch(
          editor.state.tr.setMeta(selectionToolbarPluginKey, 'updatePosition'),
        );
      });
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !visibleRef.current) {
        return;
      }
      if (event.key === 'Escape') {
        dismissedRef.current = editor.state.selection;
        editor.view.dispatch(
          editor.state.tr.setMeta(selectionToolbarPluginKey, 'hide'),
        );
      } else if (event.altKey && event.key === 'F10') {
        event.preventDefault();
        const toolbar = toolbarRef.current;
        (
          toolbar?.querySelector<HTMLElement>(
            '[data-toolbar-item][tabindex="0"]:not(:disabled)',
          ) ??
          toolbar?.querySelector<HTMLElement>(
            '[data-toolbar-item]:not(:disabled)',
          )
        )?.focus();
      }
    };
    dom.addEventListener('mousedown', handleMouseDown);
    dom.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      dom.removeEventListener('mousedown', handleMouseDown);
      dom.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [editor, canShow]);

  const closePanel = useCallback(() => setPanel(null), []);

  const handleToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Ignore keys bubbling up from the dropdown content or the link panel.
    if (
      !(event.target instanceof HTMLElement) ||
      !event.target.hasAttribute('data-toolbar-item')
    ) {
      return;
    }
    const items = Array.from(
      toolbarRef.current?.querySelectorAll<HTMLElement>(
        '[data-toolbar-item]:not(:disabled)',
      ) ?? [],
    );
    const current = items.indexOf(event.target);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % items.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        editor?.commands.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  };

  if (!editor || entries.length === 0) {
    return null;
  }

  const Panel = panel?.panel;
  let itemIndex = 0;
  const nextItemProps = () => {
    const index = itemIndex++;
    return {
      'data-toolbar-item': true,
      tabIndex: index === focusIndex ? 0 : -1,
      onFocus: () => setFocusIndex(index),
    };
  };

  const renderEntry = (entry: ResolvedMenuEntry, key: number) => {
    switch (entry.type) {
      case 'separator':
        return (
          <hr
            key={key}
            aria-orientation="vertical"
            className="mx-0.5 h-5 w-px border-0 bg-border"
          />
        );
      case 'command':
        return (
          <ToolbarButton
            key={key}
            editor={editor}
            command={entry.command}
            onOpenPanel={setPanel}
            {...nextItemProps()}
          />
        );
      case 'dropdown':
        return (
          <ToolbarDropdown
            key={key}
            editor={editor}
            entry={entry}
            {...nextItemProps()}
          />
        );
      case 'group':
        return (
          // biome-ignore lint/a11y/useSemanticElements: an ARIA group inside a toolbar; fieldset is for form controls
          <div
            key={key}
            role="group"
            aria-label={entry.label()}
            className="flex items-center gap-0.5"
          >
            {entry.commands.map((command, index) => (
              <ToolbarButton
                key={index}
                editor={editor}
                command={command}
                onOpenPanel={setPanel}
                {...nextItemProps()}
              />
            ))}
          </div>
        );
    }
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={selectionToolbarPluginKey}
      appendTo={appendTo}
      shouldShow={shouldShow}
      options={options}
      className="z-50"
    >
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label={m.selection_menu_toolbar_aria()}
        aria-orientation="horizontal"
        className="flex items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        onKeyDown={handleToolbarKeyDown}
      >
        {Panel ? (
          <Panel editor={editor} close={closePanel} />
        ) : (
          entries.map(renderEntry)
        )}
      </div>
    </BubbleMenu>
  );
}

interface ToolbarItemProps {
  'data-toolbar-item': boolean;
  tabIndex: number;
  onFocus: () => void;
}

function ToolbarButton({
  editor,
  command,
  onOpenPanel,
  ...itemProps
}: ToolbarItemProps & {
  editor: Editor;
  command: EditorMenuCommand;
  onOpenPanel: (command: EditorMenuCommand) => void;
}) {
  const Icon = command.icon;
  const label = command.label();
  const active = command.isActive?.(editor) ?? false;
  const enabled = command.isEnabled?.(editor) ?? true;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7', active && 'bg-accent text-accent-foreground')}
      aria-label={label}
      aria-pressed={command.panel ? undefined : active}
      title={commandTitle(command)}
      disabled={!enabled}
      // Keeps the editor focused so the selection survives the click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (command.panel) {
          onOpenPanel(command);
        } else {
          runEditorMenuCommand(command, { editor, surface: 'selection' });
        }
      }}
      {...itemProps}
    >
      {Icon ? <Icon /> : label}
    </Button>
  );
}

function ToolbarDropdown({
  editor,
  entry,
  ...itemProps
}: ToolbarItemProps & {
  editor: Editor;
  entry: ResolvedMenuGroup;
}) {
  const activeCommands = entry.commands.filter((command) =>
    command.isActive?.(editor),
  );
  const current = activeCommands.length === 1 ? activeCommands[0] : undefined;
  const CurrentIcon = current?.icon;
  return (
    // Non-modal so the editor behind stays scrollable and the bubble menu
    // keeps tracking focus inside it.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2"
          title={entry.label()}
          {...itemProps}
        >
          {CurrentIcon && <CurrentIcon />}
          <span>{current?.label() ?? m.selection_menu_block_type_mixed()}</span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      {/* Rendered inside the bubble menu: a portal would move focus outside
          it and make the menu hide itself. */}
      <DropdownMenuContent
        disablePortal
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        {entry.commands.map((command, index) => {
          const Icon = command.icon;
          return (
            <DropdownMenuItem
              key={index}
              disabled={!(command.isEnabled?.(editor) ?? true)}
              title={commandTitle(command)}
              onSelect={() =>
                runEditorMenuCommand(command, { editor, surface: 'selection' })
              }
            >
              {Icon && <Icon />}
              <span>{command.label()}</span>
              {command === current && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
