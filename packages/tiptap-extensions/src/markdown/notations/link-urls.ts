import type { Mark, MarkType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

import { typesAtCaret } from '../../typed-marks';
import { isRemote } from '../changes';

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
      if (!transactions.some((tr) => tr.docChanged && !isRemote(tr))) {
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

function isBare(link: LinkRange): boolean {
  return autolinkHrefs(link.text).includes(link.mark.attrs.href);
}

/**
 * Makes text typed into a word a link as soon as markdown reads the word as
 * one, as it reads a bare URL, rather than once whitespace ends it. `read`
 * reads markdown as the document's definitions do.
 */
export function typedUrlsPlugin(
  type: MarkType,
  read: (markdown: string) => ProseMirrorNode,
): Plugin {
  return new Plugin({
    appendTransaction: (transactions, _, state) => {
      const { selection } = state;
      if (
        !transactions.some(typesAtCaret) ||
        transactions.some((tr) => isRemote(tr) || tr.getMeta('composition')) ||
        !(selection instanceof TextSelection) ||
        !selection.$cursor ||
        selection.$cursor.parent.type.spec.code
      ) {
        return null;
      }
      const $cursor = selection.$cursor;
      const { parent } = $cursor;
      const start = $cursor.start();
      const links = linksIn(parent, start, type);
      const linkAt = (pos: number) =>
        links.find((link) => link.from <= pos && pos < link.to);
      // GFM links no text in a link, nor in what excludes one, such as code.
      const takes = (node: ProseMirrorNode, pos: number) => {
        const link = linkAt(pos);
        return (
          node.isText &&
          (!link || isBare(link)) &&
          !node.marks.some(
            (mark) => mark.type !== type && mark.type.excludes(type),
          )
        );
      };
      // The text around the caret that markdown could link, up to whitespace.
      let before = '';
      let after = '';
      let ended = false;
      parent.forEach((child, offset) => {
        const childStart = start + offset;
        const childEnd = childStart + child.nodeSize;
        if (ended) {
          return;
        }
        if (!takes(child, childStart)) {
          if (childStart >= $cursor.pos) {
            ended = true;
          } else {
            before = '';
          }
          return;
        }
        const text = child.text ?? '';
        if (childEnd <= $cursor.pos) {
          before += text;
        } else if (childStart >= $cursor.pos) {
          after += text;
        } else {
          before += text.slice(0, $cursor.pos - childStart);
          after += text.slice($cursor.pos - childStart);
        }
      });
      const head = before.match(/\S*$/)?.[0] ?? '';
      const word = head + (after.match(/^\S*/)?.[0] ?? '');
      if (!word.includes('.')) {
        return null;
      }
      const wordFrom = $cursor.pos - head.length;
      const wordTo = wordFrom + word.length;
      const doc = read(word);
      const paragraph = doc.childCount === 1 ? doc.firstChild : null;
      if (!paragraph?.isTextblock || paragraph.textContent !== word) {
        return null;
      }
      // The word holds no links but bare ones, so they are made again as
      // markdown reads it. Joined to a link right before the word, a link
      // would take in that link's text, so the word is left as text then.
      const wanted: LinkRange[] = [];
      for (const found of linksIn(paragraph, wordFrom, type)) {
        const previous = state.doc.resolve(found.from).nodeBefore;
        const mark = type.create({ href: found.mark.attrs.href });
        if (
          found.from === wordFrom &&
          previous &&
          mark.isInSet(previous.marks)
        ) {
          wanted.length = 0;
          break;
        }
        if (isBare(found)) {
          wanted.push({ ...found, mark });
        }
      }
      const current = links.filter(
        (link) => link.to > wordFrom && link.from < wordTo,
      );
      if (
        current.length === wanted.length &&
        current.every(
          (link, i) =>
            link.from === wanted[i].from &&
            link.to === wanted[i].to &&
            link.mark.attrs.href === wanted[i].mark.attrs.href,
        )
      ) {
        return null;
      }
      const tr = state.tr.removeMark(wordFrom, wordTo, type);
      for (const link of wanted) {
        tr.addMark(link.from, link.to, link.mark);
      }
      return tr.docChanged ? tr : null;
    },
  });
}
