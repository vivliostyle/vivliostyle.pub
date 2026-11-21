import { Extension } from '@tiptap/core';
import {
  type Attrs,
  NodeRange,
  type NodeType,
  type ResolvedPos,
} from '@tiptap/pm/model';
import { wrapRangeInList } from '@tiptap/pm/schema-list';
import type { EditorState, Selection, Transaction } from '@tiptap/pm/state';
import { canJoin, findWrapping, liftTarget } from '@tiptap/pm/transform';

export type BlockFormat =
  | 'paragraph'
  | `heading-${1 | 2 | 3 | 4 | 5 | 6}`
  | 'blockquote'
  | 'bullet-list'
  | 'ordered-list'
  | 'code-block';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockFormat: {
      /**
       * Changes the format of the selected blocks without moving them out of
       * the lists and quotes they are nested in.
       */
      setBlockFormat: (format: BlockFormat) => ReturnType;
      /** Like `setBlockFormat`, but turns blocks that already have it into paragraphs. */
      toggleBlockFormat: (format: BlockFormat) => ReturnType;
    };
  }
}

const formatNodeNames = {
  paragraph: 'paragraph',
  blockquote: 'blockquote',
  'bullet-list': 'bulletList',
  'ordered-list': 'orderedList',
  'code-block': 'codeBlock',
} as const;

const listFormats: Record<string, BlockFormat> = {
  bulletList: 'bullet-list',
  orderedList: 'ordered-list',
};

function isListItemLabel($inner: ResolvedPos): boolean {
  return (
    $inner.depth >= 3 &&
    $inner.node(-1).type.name === 'listItem' &&
    $inner.index(-1) === 0
  );
}

function isQuotedParagraph($inner: ResolvedPos): boolean {
  return (
    $inner.parent.type.name === 'paragraph' &&
    $inner.depth >= 2 &&
    $inner.node(-1).type.name === 'blockquote'
  );
}

// A list item reads as its list and a quoted paragraph as a quote, since those
// wrappers are what the format menu replaces; headings and code blocks keep
// their own format wherever they are nested.
function formatAt($inner: ResolvedPos): BlockFormat | null {
  const node = $inner.parent;
  if (node.type.spec.code) {
    return 'code-block';
  }
  if (node.type.name === 'heading') {
    return `heading-${node.attrs.level}` as BlockFormat;
  }
  if (node.type.name !== 'paragraph') {
    return null;
  }
  if (isListItemLabel($inner)) {
    return listFormats[$inner.node(-2).type.name] ?? null;
  }
  return isQuotedParagraph($inner) ? 'blockquote' : 'paragraph';
}

/** Positions at the start of each textblock the selection touches. */
function selectedTextblocks(selection: Selection): number[] {
  const doc = selection.$from.doc;
  const positions: number[] = [];
  for (const { $from, $to } of selection.ranges) {
    doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.isTextblock) {
        positions.push(pos + 1);
        return false;
      }
      return true;
    });
  }
  return positions;
}

/**
 * The format shared by every selected block, or null when they differ. Unlike
 * `$from`/`$to`, this also sees the blocks inside an `AllSelection`.
 */
export function getBlockFormat(state: EditorState): BlockFormat | null {
  const { doc, selection } = state;
  let format: BlockFormat | null = null;
  for (const pos of selectedTextblocks(selection)) {
    const current = formatAt(doc.resolve(pos));
    if (!current || (format && current !== format)) {
      return null;
    }
    format = current;
  }
  return format;
}

type Target =
  | { kind: 'textblock'; type: NodeType; attrs: Attrs | null }
  | { kind: 'blockquote'; type: NodeType }
  | { kind: 'list'; type: NodeType };

function resolveTarget(
  format: BlockFormat,
  nodes: Record<string, NodeType | undefined>,
): Target | null {
  const level = format.match(/^heading-(\d)$/)?.[1];
  if (level) {
    return nodes.heading
      ? {
          kind: 'textblock',
          type: nodes.heading,
          attrs: { level: Number(level) },
        }
      : null;
  }
  const type = nodes[formatNodeNames[format as keyof typeof formatNodeNames]];
  if (!type) {
    return null;
  }
  switch (format) {
    case 'blockquote':
      return { kind: 'blockquote', type };
    case 'bullet-list':
    case 'ordered-list':
      return { kind: 'list', type };
    default:
      return { kind: 'textblock', type, attrs: null };
  }
}

function isList(type: NodeType | undefined): boolean {
  return !!type && type.name in listFormats;
}

// Markdown cannot keep two adjacent lists of the same type apart, so merge
// them in the editor as well.
function joinListsAt(tr: Transaction, pos: number): void {
  const $pos = tr.doc.resolve(pos);
  const { nodeBefore, nodeAfter } = $pos;
  if (
    nodeBefore &&
    nodeAfter &&
    nodeBefore.type === nodeAfter.type &&
    isList(nodeBefore.type) &&
    canJoin(tr.doc, pos)
  ) {
    tr.join(pos);
  }
}

function joinListsAround(tr: Transaction, pos: number): void {
  const node = tr.doc.nodeAt(pos);
  if (node) {
    joinListsAt(tr, pos + node.nodeSize);
  }
  joinListsAt(tr, pos);
}

/** Moves the whole item, nested children included, into its list's parent. */
function unwrapListItem(tr: Transaction, $inner: ResolvedPos): void {
  const depth = $inner.depth - 1;
  const item = $inner.node(depth);
  const itemPos = $inner.before(depth);
  const range = new NodeRange(
    tr.doc.resolve(itemPos + 1),
    tr.doc.resolve(itemPos + item.nodeSize - 1),
    depth,
  );
  const target = liftTarget(range);
  if (target === null) {
    return;
  }
  const mapFrom = tr.mapping.maps.length;
  tr.lift(range, target);
  // The item's last child may be a list that now sits next to the rest of
  // the list the item was split out of.
  const $lifted = tr.doc.resolve(tr.mapping.slice(mapFrom).map($inner.pos));
  const parentDepth = $lifted.depth - 1;
  joinListsAt(
    tr,
    $lifted.posAtIndex(
      $lifted.index(parentDepth) + item.childCount,
      parentDepth,
    ),
  );
}

function liftOutOfQuote(tr: Transaction, $inner: ResolvedPos): void {
  const range = $inner.blockRange(
    $inner,
    (node) => node.type.name === 'blockquote',
  );
  const target = range && liftTarget(range);
  if (range && target !== null && target !== undefined) {
    tr.lift(range, target);
  }
}

function hasFormatType(
  $inner: ResolvedPos,
  type: NodeType,
  attrs: Attrs | null,
): boolean {
  const node = $inner.parent;
  return (
    node.type === type &&
    Object.entries(attrs ?? {}).every(
      ([key, value]) => node.attrs[key] === value,
    )
  );
}

function applyBlockFormat(tr: Transaction, target: Target): void {
  const { paragraph } = tr.doc.type.schema.nodes;
  if (!paragraph) {
    return;
  }
  const startMaps = tr.mapping.maps.length;
  const resolve = (pos: number) =>
    tr.doc.resolve(tr.mapping.slice(startMaps).map(pos));

  const toWrap: number[] = [];
  for (const pos of selectedTextblocks(tr.selection)) {
    let $inner = resolve(pos);
    if (!$inner.parent.isTextblock) {
      continue;
    }
    if (isListItemLabel($inner)) {
      if (target.kind === 'list') {
        const listPos = $inner.before(-2);
        if ($inner.node(-2).type !== target.type) {
          tr.setNodeMarkup(listPos, target.type);
          joinListsAround(tr, listPos);
        }
        continue;
      }
      unwrapListItem(tr, $inner);
    } else if (target.kind !== 'blockquote' && isQuotedParagraph($inner)) {
      liftOutOfQuote(tr, $inner);
    }

    $inner = resolve(pos);
    const type = target.kind === 'textblock' ? target.type : paragraph;
    const attrs = target.kind === 'textblock' ? target.attrs : null;
    if (!hasFormatType($inner, type, attrs)) {
      tr.setBlockType($inner.pos, $inner.pos, type, attrs);
    }
    if (
      target.kind === 'list' ||
      (target.kind === 'blockquote' && !isQuotedParagraph(resolve(pos)))
    ) {
      toWrap.push(pos);
    }
  }

  // Consecutive siblings share one wrapper; blocks that ended up at different
  // depths are wrapped where they are.
  const runs: number[][] = [];
  let previous: { parent: number; index: number } | undefined;
  for (const pos of toWrap) {
    const $inner = resolve(pos);
    const current = { parent: $inner.start(-1), index: $inner.index(-1) };
    const run = runs.at(-1);
    if (
      run &&
      previous?.parent === current.parent &&
      previous.index + 1 === current.index
    ) {
      run.push(pos);
    } else {
      runs.push([pos]);
    }
    previous = current;
  }
  for (const run of runs.reverse()) {
    const $first = resolve(run[0] ?? 0);
    const $last = resolve(run.at(-1) ?? 0);
    const range = new NodeRange(
      tr.doc.resolve($first.before()),
      tr.doc.resolve($last.after()),
      $first.depth - 1,
    );
    if (target.kind === 'blockquote') {
      const wrapping = findWrapping(range, target.type);
      if (wrapping) {
        tr.wrap(range, wrapping);
      }
    } else if (wrapRangeInList(tr, range, target.type)) {
      joinListsAround(tr, range.start);
    }
  }
}

export const BlockFormatting = Extension.create({
  name: 'blockFormatting',

  // Runs before the node extensions' own shortcuts (Paragraph's priority is
  // 1000), whose commands lift the block out of every list and quote.
  priority: 1001,

  addCommands() {
    return {
      setBlockFormat:
        (format) =>
        ({ tr, dispatch }) => {
          const target = resolveTarget(format, tr.doc.type.schema.nodes);
          if (
            !target ||
            !selectedTextblocks(tr.selection).some(
              (pos) => formatAt(tr.doc.resolve(pos)) !== format,
            )
          ) {
            return false;
          }
          if (dispatch) {
            applyBlockFormat(tr, target);
          }
          return true;
        },
      toggleBlockFormat:
        (format) =>
        ({ state, commands }) =>
          commands.setBlockFormat(
            getBlockFormat(state) === format ? 'paragraph' : format,
          ),
    };
  },

  addKeyboardShortcuts() {
    const toggle = (format: BlockFormat) => () => {
      this.editor.commands.toggleBlockFormat(format);
      return true;
    };
    return {
      'Mod-Alt-0': () => {
        this.editor.commands.setBlockFormat('paragraph');
        return true;
      },
      'Mod-Alt-1': toggle('heading-1'),
      'Mod-Alt-2': toggle('heading-2'),
      'Mod-Alt-3': toggle('heading-3'),
      'Mod-Alt-4': toggle('heading-4'),
      'Mod-Alt-5': toggle('heading-5'),
      'Mod-Alt-6': toggle('heading-6'),
      'Mod-Alt-c': toggle('code-block'),
      'Mod-Shift-b': toggle('blockquote'),
      'Mod-Shift-7': toggle('ordered-list'),
      'Mod-Shift-8': toggle('bullet-list'),
    };
  },
});
