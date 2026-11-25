import { Extension, InputRule } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { hasDocumentNotation } from '../../extension';
import {
  childrenOf,
  type MdastNodeOf,
  type UnknownMdastNode,
} from '../../mdast';
import { transformPlugin } from '../../micromark';
import { defineNotation } from '../../notation';
import { convertListItem } from '../commonmark';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    taskListItem: {
      /**
       * Makes the list item the selection is in a task, or a task an item
       * again with `null`.
       */
      setTaskItem: (checked: boolean | null) => ReturnType;
    };
  }
}

interface ItemMdast extends UnknownMdastNode {
  checked?: boolean | null;
}

/**
 * `- [ ] ` with nothing after the checkbox is a task to VFM 2, and its
 * checkbox text to micromark.
 */
function readEmptyTasks(tree: UnknownMdastNode, source: string): void {
  const visit = (node: UnknownMdastNode) => {
    if (node.type === 'listItem') {
      const item = node as ItemMdast;
      const [first, ...rest] = childrenOf(item);
      const text = childrenOf(first ?? { type: '' });
      const start = text[0]?.position?.start.offset;
      const end = text[0]?.position?.end.offset;
      const box =
        start === undefined || end === undefined
          ? null
          : source.slice(start, end).match(/^\[([ xX])\]$/);
      if (
        item.checked == null &&
        first?.type === 'paragraph' &&
        text.length === 1 &&
        box &&
        end !== undefined &&
        /^[ \t]/.test(source.slice(end, end + 1))
      ) {
        item.checked = box[1] !== ' ';
        node.children = rest;
      }
    }
    childrenOf(node).forEach(visit);
  };
  visit(tree);
}

function findItem(
  state: EditorState,
): { pos: number; node: ProseMirrorNode; depth: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'listItem') {
      return { pos: $from.before(depth), node, depth };
    }
  }
  return null;
}

const taskListKey = new PluginKey<DecorationSet>('taskList');

function checkbox(checked: boolean) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const at = getPos();
      // The widget sits at the start of the item's first paragraph.
      const pos = at === undefined ? -1 : at - 2;
      const item = pos < 0 ? null : view.state.doc.nodeAt(pos);
      if (item?.type.name !== 'listItem' || item.attrs.checked == null) {
        return;
      }
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...item.attrs,
          checked: !item.attrs.checked,
        }),
      );
    });
    return input;
  };
}

// The checkbox is a widget in the item's first paragraph, where VFM puts it
// in a loose list, and the list's class depends on its items.
function taskDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      let tasks = false;
      node.forEach((item) => {
        tasks ||= item.attrs.checked != null;
      });
      if (tasks) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'contains-task-list',
          }),
        );
      }
    } else if (node.type.name === 'listItem' && node.attrs.checked != null) {
      const checked = Boolean(node.attrs.checked);
      decorations.push(
        Decoration.widget(pos + 2, checkbox(checked), {
          side: -1,
          ignoreSelection: true,
          key: `task-${checked}`,
          stopEvent: () => true,
        }),
      );
    }
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decorations);
}

const TaskList = Extension.create({
  name: 'taskList',

  addGlobalAttributes() {
    return [
      {
        types: ['listItem'],
        attributes: {
          checked: {
            default: null,
            parseHTML: (element) =>
              element.classList.contains('task-list-item')
                ? Boolean(
                    element.querySelector<HTMLInputElement>(
                      'input[type="checkbox"]',
                    )?.checked,
                  )
                : null,
            renderHTML: (attrs) =>
              attrs.checked == null ? {} : { class: 'task-list-item' },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTaskItem:
        (checked) =>
        ({ editor, state, tr, dispatch }) => {
          const item = findItem(state);
          if (!item || !hasDocumentNotation(editor, this.name)) {
            return false;
          }
          dispatch?.(
            tr.setNodeMarkup(item.pos, undefined, {
              ...item.node.attrs,
              checked,
            }),
          );
          return true;
        },
    };
  },

  // A new item after a task is a task to do.
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const item = findItem(this.editor.state);
        if (
          !item ||
          item.node.attrs.checked == null ||
          item.node.textContent === '' ||
          !hasDocumentNotation(this.editor, this.name)
        ) {
          return false;
        }
        return this.editor
          .chain()
          .splitListItem('listItem')
          .command(({ tr }) => {
            const $from = tr.selection.$from;
            const next =
              $from.depth >= item.depth ? $from.node(item.depth) : null;
            const at = tr.mapping.map(item.pos);
            const before = tr.doc.nodeAt(at);
            if (
              next?.type.name === 'listItem' &&
              before &&
              $from.before(item.depth) === at + before.nodeSize
            ) {
              tr.setNodeMarkup($from.before(item.depth), undefined, {
                ...next.attrs,
                checked: false,
              });
            }
            return true;
          })
          .run();
      },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX])\] $/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          const item = $from.depth >= 2 ? $from.node(-1) : null;
          if (
            item?.type.name !== 'listItem' ||
            item.attrs.checked != null ||
            $from.index(-1) !== 0 ||
            $from.parentOffset !== 0 ||
            !hasDocumentNotation(this.editor, this.name)
          ) {
            return null;
          }
          const { tr } = state;
          tr.delete(range.from, range.to);
          tr.setNodeMarkup($from.before(-1), undefined, {
            ...item.attrs,
            checked: match[1] !== ' ',
          });
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: taskListKey,
        state: {
          init: (_, { doc }) => taskDecorations(doc),
          apply: (tr, set) => (tr.docChanged ? taskDecorations(tr.doc) : set),
        },
        props: {
          decorations: (state) => taskListKey.getState(state),
        },
      }),
    ];
  },
});

export const taskListNotation = defineNotation({
  name: 'taskList',
  version: 1,
  extensions: [TaskList],
  remarkPlugins: [transformPlugin(readEmptyTasks)],
  fromMarkdown: {
    listItem: (node, context, next) =>
      typeof (node as ItemMdast).checked === 'boolean'
        ? convertListItem(node as MdastNodeOf<'listItem'>, context, {
            checkbox: 'attribute',
          })
        : next(),
  },
  nodes: {
    listItem: {
      write: (node, context, next) => {
        const written = next();
        if (node.attrs.checked == null) {
          return written;
        }
        const marker = String(context.data.marker ?? '-');
        const box = node.attrs.checked
          ? (context.base?.text?.match(/^\S+[ \t]+\[([xX])\]/)?.[1] ?? 'x')
          : ' ';
        const [head = '', ...tail] = written.split('\n');
        const content = head.slice(marker.length).replace(/^ /, '');
        return [`${marker} [${box}] ${content}`, ...tail].join('\n');
      },
    },
  },
});
