import type { Mark, MarkType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

const AUTOLINKS: readonly {
  text: RegExp;
  href: (text: string) => string;
}[] = [
  { text: /^[a-z][a-z0-9+.-]*:\/\//i, href: (text) => text },
  { text: /^www\./i, href: (text) => `http://${text}` },
  { text: /^[^@]+@[^@]+$/, href: (text) => `mailto:${text}` },
];

/**
 * The link markdown makes of the text by itself, by kind: a URL, `www.` and
 * an email address, or `null` for each kind the text is not.
 */
export function autolinkHrefs(text: string): (string | null)[] {
  return AUTOLINKS.map((kind) =>
    !/\s/.test(text) && kind.text.test(text) ? kind.href(text) : null,
  );
}

interface LinkRange {
  from: number;
  to: number;
  mark: Mark;
  text: string;
}

function linksIn(
  textblock: ProseMirrorNode,
  start: number,
  type: MarkType,
): LinkRange[] {
  const links: LinkRange[] = [];
  let open: LinkRange | null = null;
  textblock.forEach((child, offset) => {
    const pos = start + offset;
    const mark = type.isInSet(child.marks);
    if (open && mark?.eq(open.mark) && open.to === pos) {
      open.to = pos + child.nodeSize;
      open.text += child.text ?? '￼';
      return;
    }
    open = mark
      ? {
          from: pos,
          to: pos + child.nodeSize,
          mark,
          text: child.text ?? '￼',
        }
      : null;
    if (open) {
      links.push(open);
    }
  });
  return links;
}

function textMarked(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  mark: Mark,
): string {
  let text = '';
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && mark.isInSet(node.marks)) {
      text += (node.text ?? '').slice(
        Math.max(0, from - pos),
        Math.max(0, to - pos),
      );
    }
  });
  return text;
}

/** The ranges of the document the transactions changed, in it as it ends. */
function changedRanges(mapping: Mapping): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  mapping.maps.forEach((map, index) => {
    const rest = mapping.slice(index + 1);
    map.forEach((_, __, from, to) => {
      ranges.push({ from: rest.map(from, -1), to: rest.map(to, 1) });
    });
  });
  return ranges;
}

/**
 * Makes a link whose text is its URL, as a bare URL is, follow its text as
 * it is edited, and takes the link off once the text is no URL: in
 * markdown, the text of a bare URL is all there is of its link.
 */
export function linkUrlsPlugin(type: MarkType): Plugin {
  return new Plugin({
    appendTransaction: (transactions, oldState, state) => {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }
      const mapping = new Mapping(
        transactions.flatMap((tr) => tr.mapping.maps),
      );
      const back = mapping.invert();
      const { doc } = state;
      const tr = state.tr;
      const seen = new Set<number>();
      for (const range of changedRanges(mapping)) {
        const from = Math.max(0, range.from - 1);
        const to = Math.min(doc.content.size, range.to + 1);
        doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isTextblock) {
            return true;
          }
          for (const link of linksIn(node, pos + 1, type)) {
            if (
              seen.has(link.from) ||
              link.to < range.from ||
              link.from > range.to
            ) {
              continue;
            }
            seen.add(link.from);
            const before = textMarked(
              oldState.doc,
              back.map(link.from, -1),
              back.map(link.to, 1),
              link.mark,
            );
            const kind = autolinkHrefs(before).indexOf(link.mark.attrs.href);
            if (kind === -1 || before === link.text) {
              continue;
            }
            const href = autolinkHrefs(link.text)[kind];
            if (href === null) {
              tr.removeMark(link.from, link.to, link.mark);
            } else if (href !== link.mark.attrs.href) {
              tr.addMark(
                link.from,
                link.to,
                type.create({ ...link.mark.attrs, href }),
              );
            }
          }
          return false;
        });
      }
      return tr.docChanged ? tr : null;
    },
  });
}
