import type { JSONContent } from '@tiptap/core';
import { ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import type { EditorState } from '@tiptap/pm/state';

const listTypeNames = new Set(['bulletList', 'orderedList']);

function isEmptyParagraph(node: JSONContent | undefined): boolean {
  return node?.type === 'paragraph' && !node.content?.length;
}

// CommonMark only lets a list interrupt a paragraph when its first item has
// content and, for ordered lists, starts at 1.
function canInterruptParagraph(list: JSONContent): boolean {
  if (list.type === 'orderedList' && (Number(list.attrs?.start) || 1) !== 1) {
    return false;
  }
  return !isEmptyParagraph(list.content?.[0]?.content?.[0]);
}

function indentLines(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
}

export const PubListItem = ListItem.extend({
  parseMarkdown(token, helpers) {
    const item = ListItem.config.parseMarkdown?.(token, helpers);
    if (!item || Array.isArray(item)) {
      return item ?? [];
    }
    // `- > quote` or `-\n  - nested` are valid markdown, but the schema
    // requires every item to start with a paragraph.
    if (item.content?.[0]?.type !== 'paragraph') {
      item.content = [{ type: 'paragraph' }, ...(item.content ?? [])];
    }
    return item;
  },

  renderMarkdown(node, h, ctx) {
    const [first, ...rest] = node.content ?? [];
    const marker =
      ctx.parentType === 'orderedList'
        ? `${(Number(ctx.meta?.parentAttrs?.start) || 1) + ctx.index}. `
        : '- ';
    // Item content must start at the marker's width, or VFM (and CommonMark)
    // reads it as a sibling: `1. ` needs three spaces, `10. ` four.
    const indent = ' '.repeat(marker.length);
    const render = (child: JSONContent, index: number) =>
      h.renderChild?.(child, index) ?? h.renderChildren([child]);

    const [head = '', ...tail] = first ? render(first, 0).split('\n') : [];
    // marked only starts an item whose content begins on the next line at a
    // marker without the trailing space.
    let output = head ? marker + head : marker.trimEnd();
    for (const line of tail) {
      output += `\n${line ? indent + line : line}`;
    }
    rest.forEach((child, index) => {
      const previous = index === 0 ? first : rest[index - 1];
      // A blank line after an empty first paragraph would end the item. VFM
      // needs one before anything else but a list following a paragraph.
      const tight =
        (index === 0 && isEmptyParagraph(first)) ||
        (previous?.type === 'paragraph' &&
          listTypeNames.has(child.type ?? '') &&
          canInterruptParagraph(child));
      output += `${tight ? '\n' : '\n\n'}${indentLines(render(child, index + 1), indent)}`;
    });
    return output;
  },
});

export const PubOrderedList = OrderedList.extend({
  // TipTap's own ordered list tokenizer assumes the two-space indentation its
  // serializer used to write and mis-dedents properly indented content, so
  // leave ordered lists to marked's CommonMark tokenizer like bullet lists.
  markdownTokenizer: {
    name: 'orderedList',
    level: 'block',
    start: () => -1,
    tokenize: () => undefined,
  },

  parseMarkdown(token, helpers) {
    if (token.type !== 'list' || !token.ordered) {
      return [];
    }
    const start = Number(token.start) || 1;
    return {
      type: 'orderedList',
      ...(start !== 1 && { attrs: { start } }),
      content: token.items ? helpers.parseChildren(token.items) : [],
    };
  },
});

function isInListItemContinuation(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'listItem') {
      return $from.index(depth) > 0;
    }
  }
  return false;
}

export const PubListKeymap = ListKeymap.extend({
  addKeyboardShortcuts() {
    const shortcuts = this.parent?.() ?? {};
    // ListKeymap lifts the whole item when Backspace is pressed at the start
    // of any block in it; past the first one, ProseMirror's join is wanted.
    const backspace =
      (name: string): (typeof shortcuts)[string] =>
      (props) =>
        !isInListItemContinuation(props.editor.state) &&
        (shortcuts[name]?.(props) ?? false);
    return {
      ...shortcuts,
      Backspace: backspace('Backspace'),
      'Mod-Backspace': backspace('Mod-Backspace'),
    };
  },
});
