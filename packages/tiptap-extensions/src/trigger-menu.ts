import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Selection, Transaction } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export interface TriggerDefinition {
  menuId: string;
  chars: readonly string[];
}

export interface TriggerMenuRange {
  from: number;
  to: number;
}

export interface TriggerMenuMatch {
  menuId: string;
  trigger: string;
  /** From the trigger start to the cursor, i.e. the text to delete on select. */
  range: TriggerMenuRange;
  query: string;
  clientRect: () => DOMRect | null;
}

export interface ActiveTrigger {
  menuId: string;
  trigger: string;
  from: number;
}

export interface TriggerMenuOptions {
  /** Read on every input so trigger changes apply without recreating the editor. */
  getTriggers: () => readonly TriggerDefinition[];
  /** `pos` is where the trigger is being typed (or the cursor right after it). */
  isAllowed: (state: EditorState, pos: number) => boolean;
  onOpen: (editor: Editor, match: TriggerMenuMatch) => void;
  onUpdate: (editor: Editor, match: TriggerMenuMatch) => void;
  onClose: (editor: Editor) => void;
  /** Called only while a trigger is active. Return true to consume the key. */
  onKeyDown: (editor: Editor, event: KeyboardEvent) => boolean;
}

type TriggerMenuMeta =
  | { type: 'open'; active: ActiveTrigger }
  | { type: 'close' };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    triggerMenu: {
      closeTriggerMenu: () => ReturnType;
    };
  }
}

export const triggerMenuPluginKey = new PluginKey<ActiveTrigger | null>(
  'triggerMenu',
);

// Hard breaks count as whitespace so a trigger typed at the start of a soft
// line opens the menu; any other inline leaf (e.g. an image) does not.
function leafText(node: ProseMirrorNode): string {
  return node.type.spec.linebreakReplacement ? '\n' : '￼';
}

export function findTriggerMatch(
  textBefore: string,
  triggers: readonly TriggerDefinition[],
): { menuId: string; trigger: string; offset: number } | null {
  for (const { menuId, chars } of triggers) {
    for (const trigger of chars) {
      if (!trigger || !textBefore.endsWith(trigger)) {
        continue;
      }
      const offset = textBefore.length - trigger.length;
      if (offset > 0 && !/\s/.test(textBefore.charAt(offset - 1))) {
        continue;
      }
      return { menuId, trigger, offset };
    }
  }
  return null;
}

export function isOutsideCode(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.spec.code) {
    return false;
  }
  const marks = state.storedMarks ?? $pos.marks();
  return !marks.some((mark) => mark.type.spec.code);
}

/**
 * Returns the trigger's range and query if it is still valid against the given
 * document and selection, or null when the menu should close.
 */
export function resolveActiveTrigger(
  active: ActiveTrigger,
  doc: ProseMirrorNode,
  selection: Selection,
): { range: TriggerMenuRange; query: string } | null {
  const triggerEnd = active.from + active.trigger.length;
  if (active.from < 0 || triggerEnd > doc.content.size) {
    return null;
  }
  if (!selection.empty) {
    return null;
  }
  const $head = selection.$head;
  if ($head.pos < triggerEnd) {
    return null;
  }
  const $from = doc.resolve(active.from);
  if (!$from.parent.isTextblock || !$head.sameParent($from)) {
    return null;
  }
  if (doc.textBetween(active.from, triggerEnd) !== active.trigger) {
    return null;
  }
  const query = doc.textBetween(triggerEnd, $head.pos, undefined, leafText);
  if (/[\s￼]/.test(query)) {
    return null;
  }
  return { range: { from: active.from, to: $head.pos }, query };
}

// y-prosemirror applies remote updates by replacing the whole document, which
// maps every position as deleted. Recover the trigger from the restored cursor
// instead, accepting only a spot where it could have been opened.
function relocateTrigger(
  active: ActiveTrigger,
  selection: Selection,
): ActiveTrigger | null {
  const $head = selection.$head;
  if (!selection.empty || !$head.parent.isTextblock) {
    return null;
  }
  const text = $head.parent.textBetween(
    0,
    $head.parentOffset,
    undefined,
    leafText,
  );
  const index = text.lastIndexOf(active.trigger);
  if (index < 0 || (index > 0 && !/\s/.test(text.charAt(index - 1)))) {
    return null;
  }
  return { ...active, from: $head.start() + index };
}

export function applyTriggerMenuTransaction(
  active: ActiveTrigger | null,
  tr: Transaction,
): ActiveTrigger | null {
  const meta = tr.getMeta(triggerMenuPluginKey) as TriggerMenuMeta | undefined;
  if (meta?.type === 'close') {
    return null;
  }
  let next = meta?.type === 'open' ? meta.active : active;
  if (!next) {
    return null;
  }
  if (next === active && tr.docChanged) {
    const mapped = tr.mapping.mapResult(next.from, 1);
    if (mapped.deleted) {
      next = relocateTrigger(next, tr.selection);
      if (!next) {
        return null;
      }
    } else if (mapped.pos !== next.from) {
      next = { ...next, from: mapped.pos };
    }
  }
  return resolveActiveTrigger(next, tr.doc, tr.selection) ? next : null;
}

export function getActiveTrigger(state: EditorState): ActiveTrigger | null {
  return triggerMenuPluginKey.getState(state) ?? null;
}

export function getTriggerMenuRange(
  state: EditorState,
): TriggerMenuRange | null {
  const active = getActiveTrigger(state);
  if (!active) {
    return null;
  }
  return (
    resolveActiveTrigger(active, state.doc, state.selection)?.range ?? null
  );
}

function toMatch(view: EditorView, active: ActiveTrigger): TriggerMenuMatch {
  const resolved = resolveActiveTrigger(
    active,
    view.state.doc,
    view.state.selection,
  );
  const range = resolved?.range ?? { from: active.from, to: active.from };
  return {
    menuId: active.menuId,
    trigger: active.trigger,
    range,
    query: resolved?.query ?? '',
    clientRect: () => {
      if (view.isDestroyed) {
        return null;
      }
      const current = getTriggerMenuRange(view.state);
      if (!current) {
        return null;
      }
      const start = view.coordsAtPos(current.from);
      const end = view.coordsAtPos(current.to);
      return new DOMRect(
        start.left,
        start.top,
        Math.max(end.right - start.left, 0),
        Math.max(end.bottom, start.bottom) - start.top,
      );
    },
  };
}

export const TriggerMenu = Extension.create<TriggerMenuOptions>({
  name: 'triggerMenu',

  addOptions() {
    return {
      getTriggers: () => [],
      isAllowed: isOutsideCode,
      onOpen: () => {},
      onUpdate: () => {},
      onClose: () => {},
      onKeyDown: () => false,
    };
  },

  addCommands() {
    return {
      closeTriggerMenu:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(triggerMenuPluginKey, {
              type: 'close',
            } satisfies TriggerMenuMeta);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    const options = this.options;
    let compositionFrom: number | null = null;

    const matchAt = ($pos: ResolvedPos, typed: string) => {
      if (!$pos.parent.isTextblock) {
        return null;
      }
      const triggers = options.getTriggers();
      const longest = Math.max(
        0,
        ...triggers.flatMap((t) => t.chars.map((c) => c.length)),
      );
      if (longest === 0) {
        return null;
      }
      // Only the tail can matter: the whole trigger plus the one character
      // before it, so long paragraphs are not re-read on every keystroke.
      const windowStart = Math.max(0, $pos.parentOffset - longest - 1);
      const match = findTriggerMatch(
        $pos.parent.textBetween(
          windowStart,
          $pos.parentOffset,
          undefined,
          leafText,
        ) + typed,
        triggers,
      );
      if (!match) {
        return null;
      }
      return {
        menuId: match.menuId,
        trigger: match.trigger,
        from: $pos.start() + windowStart + match.offset,
      } satisfies ActiveTrigger;
    };

    // Mirrors prosemirror-inputrules: composed input is matched once the IME
    // commits, because dispatching from handleTextInput mid-composition breaks
    // the composition.
    const openAfterComposition = (view: EditorView, from: number) => {
      const { state } = view;
      if (
        !editor.isEditable ||
        getActiveTrigger(state) ||
        !state.selection.empty
      ) {
        return;
      }
      const $cursor = state.selection.$head;
      const active = matchAt($cursor, '');
      if (
        !active ||
        active.from < from ||
        !options.isAllowed(state, $cursor.pos)
      ) {
        return;
      }
      view.dispatch(
        state.tr.setMeta(triggerMenuPluginKey, {
          type: 'open',
          active,
        } satisfies TriggerMenuMeta),
      );
    };

    return [
      new Plugin<ActiveTrigger | null>({
        key: triggerMenuPluginKey,
        state: {
          init: () => null,
          apply: (tr, value) => applyTriggerMenuTransaction(value, tr),
        },
        props: {
          handleTextInput(view, from, to, text) {
            if (
              view.composing ||
              !editor.isEditable ||
              getActiveTrigger(view.state)
            ) {
              return false;
            }
            const { state } = view;
            const active = matchAt(state.doc.resolve(from), text);
            if (!active || !options.isAllowed(state, from)) {
              return false;
            }
            view.dispatch(
              state.tr
                .insertText(text, from, to)
                .setMeta(triggerMenuPluginKey, {
                  type: 'open',
                  active,
                } satisfies TriggerMenuMeta)
                .scrollIntoView(),
            );
            return true;
          },
          handleKeyDown(view, event) {
            if (!getActiveTrigger(view.state)) {
              return false;
            }
            return options.onKeyDown(editor, event);
          },
          handleDOMEvents: {
            compositionstart(view) {
              compositionFrom = view.state.selection.from;
              return false;
            },
            compositionend(view) {
              const from = compositionFrom;
              compositionFrom = null;
              if (from === null) {
                return false;
              }
              setTimeout(() => {
                if (!view.isDestroyed) {
                  openAfterComposition(view, from);
                }
              });
              return false;
            },
            blur(view) {
              if (getActiveTrigger(view.state)) {
                view.dispatch(
                  view.state.tr.setMeta(triggerMenuPluginKey, {
                    type: 'close',
                  } satisfies TriggerMenuMeta),
                );
              }
              return false;
            },
          },
        },
        view(pluginView) {
          return {
            update(view, prevState) {
              const prev = getActiveTrigger(prevState);
              const next = getActiveTrigger(view.state);
              if (!next) {
                if (prev) {
                  options.onClose(editor);
                }
                return;
              }
              if (!prev) {
                options.onOpen(editor, toMatch(view, next));
              } else {
                options.onUpdate(editor, toMatch(view, next));
              }
            },
            destroy() {
              if (getActiveTrigger(pluginView.state)) {
                options.onClose(editor);
              }
            },
          };
        },
      }),
    ];
  },
});
