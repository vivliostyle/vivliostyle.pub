import type { AnyExtension } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { BulletList } from '@tiptap/extension-bullet-list';
import { Code } from '@tiptap/extension-code';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { ListItem, OrderedList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';

import { CodeBlockPrism, toInfoString } from '../../code-block-prism';
import { PubListKeymap } from '../../list';
import type { MdastNodeOf } from '../mdast';
import {
  defineNotation,
  type InlineRun,
  type NotationDefinition,
  type ParseContext,
  type WriteContext,
} from '../notation';
import { itemPrefix, quotePrefix } from '../source';

function withMark(
  context: ParseContext,
  mark: Mark | undefined,
): readonly Mark[] | undefined {
  if (!mark) {
    return undefined;
  }
  const marks = mark.addToSet(context.marks);
  // A mark that excludes the ones around it, like inline code, would drop
  // them; the raw fallback keeps the source instead.
  return context.marks.every((it) => it.isInSet(marks)) ? marks : undefined;
}

function delimiter(context: WriteContext, key: string, safe: string) {
  return context.escaping === 'safe' ? safe : context.style(key);
}

/** A link destination, in angle brackets when it could not be read bare. */
export function linkDestination(url: string): string {
  let depth = 0;
  let balanced = true;
  for (const char of url) {
    if (char === '(') {
      depth++;
    } else if (char === ')' && --depth < 0) {
      balanced = false;
    }
  }
  if (url && balanced && depth === 0 && !/[\s<>]/.test(url)) {
    return url;
  }
  return `<${url.replace(/[<>\n]/g, (char) => (char === '\n' ? ' ' : `\\${char}`))}>`;
}

export function linkTitle(title: unknown): string {
  return typeof title === 'string' && title
    ? ` "${title.replace(/["\\]/g, '\\$&')}"`
    : '';
}

const documentNotation = defineNotation({
  name: 'document',
  extensions: [Document, Text],
  fromMarkdown: {
    text: (node, context) => context.text(node.value),
  },
  escapes: [
    { pattern: /[\\`*_[\]<]/g },
    { pattern: /&(?=#?[a-zA-Z0-9]+;)/g },
    // Whitespace would be stripped at the start and end of a line, and two
    // spaces before a line break would make it a hard break.
    { pattern: /(?<=\n)[ \t]/g, entity: true },
    { pattern: /[ \t](?=\n)/g, entity: true },
  ],
});

const paragraphNotation = defineNotation({
  name: 'paragraph',
  extensions: [Paragraph],
  fromMarkdown: {
    paragraph: (node, context) =>
      context.schema.nodes.paragraph?.create(null, context.inlines(node)),
  },
  nodes: {
    paragraph: (node, context) => context.inline(node),
  },
});

const headingNotation = defineNotation({
  name: 'heading',
  extensions: [Heading],
  fromMarkdown: {
    heading: (node, context) =>
      context.schema.nodes.heading?.create(
        { level: node.depth },
        context.inlines(node),
      ),
  },
  nodes: {
    heading: (node, context) => {
      const level = Number(node.attrs.level) || 1;
      const content = context.inline(node);
      // An ATX heading has one line, so text with line breaks needs setext.
      const setext =
        content.includes('\n') || context.style('heading') === 'setext';
      if (setext && level <= 2 && content) {
        const width = Math.max(3, content.split('\n').at(-1)?.length ?? 0);
        return `${content}\n${(level === 1 ? '=' : '-').repeat(width)}`;
      }
      const marker = '#'.repeat(level);
      return content ? `${marker} ${content.replaceAll('\n', ' ')}` : marker;
    },
  },
  styles: {
    heading: {
      default: 'atx',
      detect: {
        heading: (_, source) => (source.includes('\n') ? 'setext' : 'atx'),
      },
    },
  },
  escapes: [
    { pattern: /(?<=\n[ \t]*)#/g },
    // Hashes at the end of a heading's text would be read as its closing
    // sequence.
    { pattern: /#(?=[ \t]*\n)/g },
  ],
});

const thematicBreakNotation = defineNotation({
  name: 'thematicBreak',
  extensions: [HorizontalRule],
  fromMarkdown: {
    thematicBreak: (_, context) =>
      context.schema.nodes.horizontalRule?.create(),
  },
  nodes: {
    horizontalRule: (_, context) => {
      const rule = context.style('rule');
      // `---` opening the document would start frontmatter if another one
      // follows.
      return context.data.documentStart && rule.startsWith('-') ? '***' : rule;
    },
  },
  styles: {
    rule: {
      default: '---',
      detect: { thematicBreak: (_, source) => source.trim() },
    },
  },
  escapes: [{ pattern: /(?<=\n[ \t]*)[-=+]/g }],
});

const blockquoteNotation = defineNotation({
  name: 'blockquote',
  extensions: [Blockquote],
  fromMarkdown: {
    blockquote: (node, context) =>
      context.schema.nodes.blockquote?.createAndFill(
        null,
        context.within(quotePrefix, () => context.blocks(node)),
      ) ?? undefined,
  },
  nodes: {
    blockquote: (node, context) =>
      context
        .children(node)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n'),
  },
  escapes: [{ pattern: /(?<=\n[ \t]*)>/g }],
});

const BULLETS = ['-', '*', '+'];
const DELIMITERS = ['.', ')'];

function pick(
  preferred: string,
  options: string[],
  avoid: ReadonlySet<string>,
) {
  if (!avoid.has(preferred)) {
    return preferred;
  }
  return options.find((option) => !avoid.has(option)) ?? preferred;
}

function isEmptyParagraph(node: ProseMirrorNode | undefined): boolean {
  return node?.type.name === 'paragraph' && node.childCount === 0;
}

// CommonMark only lets a list interrupt a paragraph when its first item has
// content and, for ordered lists, starts at 1.
function canInterruptParagraph(list: ProseMirrorNode): boolean {
  if (
    list.type.name === 'orderedList' &&
    (Number(list.attrs.start) || 1) !== 1
  ) {
    return false;
  }
  return !isEmptyParagraph(list.firstChild?.firstChild ?? undefined);
}

const listTypeNames = new Set(['bulletList', 'orderedList']);

// New items follow the list: a blank line between any two items makes the
// whole list loose.
function listSeparator(context: WriteContext) {
  const content = context.base?.content();
  const loose = content?.children.some((_, index) => {
    const separator = content.separator(index);
    return separator !== null && /\n[ \t]*\n/.test(separator);
  });
  return () => (loose ? '\n\n' : '\n');
}

function itemMarkerOf(source: string): string | undefined {
  return source.match(/^(?:[-*+]|\d{1,9}[.)])(?=[ \t\n]|$)/)?.[0];
}

const listNotation = defineNotation({
  name: 'list',
  extensions: [BulletList, OrderedList, ListItem, PubListKeymap],
  fromMarkdown: {
    list: (node, context) => {
      const items = context.blocks(node);
      if (node.ordered) {
        const start = node.start ?? 1;
        return context.schema.nodes.orderedList?.create(
          start === 1 ? null : { start },
          items,
        );
      }
      return context.schema.nodes.bulletList?.create(null, items);
    },
    listItem: (node, context) => convertListItem(node, context),
  },
  nodes: {
    bulletList: {
      write: (node, context) => {
        const bullet = pick(
          context.style('bullet'),
          BULLETS,
          context.avoidMarkers,
        );
        return context.children(node, {
          data: () => ({ marker: bullet }),
          separator: listSeparator(context),
          reusable: (source) => itemMarkerOf(source) === bullet,
        });
      },
      listMarker: (source) => itemMarkerOf(source.trimStart())?.charAt(0),
    },
    orderedList: {
      write: (node, context) => {
        const start = Number(node.attrs.start) || 1;
        const delimiter = pick(
          context.style('orderedDelimiter'),
          DELIMITERS,
          context.avoidMarkers,
        );
        return context.children(node, {
          data: (index) => ({ marker: `${start + index}${delimiter}` }),
          separator: listSeparator(context),
          reusable: (source, index) =>
            itemMarkerOf(source) === `${start + index}${delimiter}`,
        });
      },
      listMarker: (source) => itemMarkerOf(source.trimStart())?.slice(-1),
    },
    listItem: (node, context) => {
      const marker = `${String(context.data.marker ?? '-')} `;
      // Item content must start at the marker's width, or VFM (and
      // CommonMark) reads it as a sibling: `1. ` needs three spaces, `10. `
      // four.
      const indent = ' '.repeat(marker.length);
      const content = context.children(node, {
        skip: (child, index) => index > 0 && isEmptyParagraph(child),
        // A blank line after an empty first paragraph would end the item.
        // VFM needs one before anything else but a list following a
        // paragraph.
        separator: (previous, next) =>
          isEmptyParagraph(previous) ||
          (previous.type.name === 'paragraph' &&
            listTypeNames.has(next.type.name) &&
            canInterruptParagraph(next))
            ? '\n'
            : '\n\n',
      });
      const [head = '', ...tail] = content.split('\n');
      return [
        head ? marker + head : marker.trimEnd(),
        ...tail.map((line) => (line ? indent + line : line)),
      ].join('\n');
    },
  },
  styles: {
    bullet: {
      default: '-',
      detect: {
        list: (node, source) =>
          (node as MdastNodeOf<'list'>).ordered ? undefined : source.charAt(0),
      },
    },
    orderedDelimiter: {
      default: '.',
      detect: {
        list: (node, source) =>
          (node as MdastNodeOf<'list'>).ordered
            ? source.match(/^\d+([.)])/)?.[1]
            : undefined,
      },
    },
  },
  escapes: [
    { pattern: /(?<=\n[ \t]*)[-+*]/g },
    { pattern: /(?<=\n[ \t]*\d{1,9})[.)]/g },
  ],
});

function convertListItem(node: MdastNodeOf<'listItem'>, context: ParseContext) {
  const { listItem, paragraph } = context.schema.nodes;
  if (!listItem || !paragraph) {
    return undefined;
  }
  const source = context.source(node);
  const marker = itemMarkerOf(source);
  if (!marker) {
    return undefined;
  }
  const firstLine = source.slice(marker.length).split('\n')[0];
  const spaces = firstLine.match(/^[ \t]*/)?.[0].length ?? 0;
  // A line with nothing after the marker, or code indented past it, puts the
  // content one column after the marker.
  const padding = spaces === firstLine.length || spaces > 4 ? 1 : spaces;
  const contentStart = marker.length + padding;
  const children = context.within(
    itemPrefix(context.column(node) + contentStart),
    () => context.blocks(node),
  );
  const [first] = children;
  const firstStart = node.children[0]?.position?.start.offset;
  const itemStart = node.position?.start.offset;
  if (
    typeof node.checked === 'boolean' &&
    first?.type === paragraph &&
    firstStart !== undefined &&
    itemStart !== undefined
  ) {
    // The checkbox has no node, so it stays in the item text as written.
    const checkbox = source.slice(contentStart, firstStart - itemStart);
    const raw = context.schema.marks.rawInline;
    children[0] = paragraph.create(first.attrs, [
      ...(raw ? context.text(checkbox, [raw.create()]) : []),
      ...childrenOfNode(first),
    ]);
  } else if (first?.type !== paragraph) {
    // `- > quote` or `-\n  - nested` are valid markdown, but the schema
    // requires every item to start with a paragraph.
    children.unshift(paragraph.create());
  }
  return listItem.create(null, children);
}

function childrenOfNode(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return children;
}

// A fence must be longer than any run of its character that could close it
// early.
function codeFence(char: string, code: string): string {
  const runs = code.match(char === '`' ? /^ {0,3}`+/gm : /^ {0,3}~+/gm);
  // Not Math.max(...runs): a long enough code block exceeds the engine's
  // argument limit.
  let longest = 0;
  for (const run of runs ?? []) {
    longest = Math.max(longest, run.trim().length);
  }
  return char.repeat(Math.max(3, longest + 1));
}

const codeBlockNotation = defineNotation({
  name: 'codeBlock',
  extensions: [CodeBlockPrism],
  fromMarkdown: {
    code: (node, context) => {
      const firstLine = context.source(node).split('\n')[0];
      // remark trims the info string and decodes its escapes; it is kept as
      // written instead.
      const info = firstLine.match(/^ {0,3}(?:`{3,}|~{3,})(.*)$/)?.[1];
      return context.schema.nodes.codeBlock?.create(
        { language: info || null },
        context.text(node.value),
      );
    },
  },
  nodes: {
    codeBlock: (node, context) => {
      // Also covers values that arrive without setCodeBlockInfo, e.g. over
      // Yjs.
      const info = toInfoString(node.attrs.language) ?? '';
      const code = node.textContent;
      // A backtick fence cannot carry backticks in its info string.
      const char = info.includes('`') ? '~' : context.style('fence');
      const fence = codeFence(char, code);
      // Leading tildes would lengthen a tilde fence instead of starting the
      // info string; markdown ignores the space.
      const separator = info.startsWith(fence.charAt(0)) ? ' ' : '';
      return `${fence}${separator}${info}\n${code}${code ? '\n' : ''}${fence}`;
    },
  },
  styles: {
    fence: {
      default: '`',
      detect: {
        code: (_, source) => source.match(/^ {0,3}([`~])\1\1/)?.[1],
      },
    },
  },
});

const hardBreakNotation = defineNotation({
  name: 'hardBreak',
  extensions: [HardBreak],
  fromMarkdown: {
    break: (_, context) =>
      context.schema.nodes.hardBreak?.create(null, null, context.marks),
  },
  nodes: {
    hardBreak: (_, context) => context.style('break'),
  },
  styles: {
    break: {
      default: '  \n',
      detect: {
        break: (_, source) => (source.startsWith('\\') ? '\\\n' : '  \n'),
      },
    },
  },
});

function imageNotation(image: AnyExtension): NotationDefinition {
  return defineNotation({
    name: 'image',
    extensions: [image],
    fromMarkdown: {
      // The schema's image is a block, so only an image standing alone in a
      // paragraph becomes one; others keep their source.
      paragraph: (node, context) => {
        const [only, ...rest] = node.children;
        if (only?.type !== 'image' || rest.length > 0) {
          return undefined;
        }
        return context.schema.nodes.image?.create({
          src: only.url,
          alt: only.alt ?? null,
          title: only.title ?? null,
        });
      },
    },
    nodes: {
      image: (node, context) => {
        const alt = String(node.attrs.alt ?? '');
        return `![${context.escaping === 'safe' ? alt.replace(/[[\]\\]/g, '\\$&') : alt}](${linkDestination(String(node.attrs.src ?? ''))}${linkTitle(node.attrs.title)})`;
      },
    },
    escapes: [{ pattern: /!(?=\[)/g }],
  });
}

const emphasisNotation = defineNotation({
  name: 'emphasis',
  extensions: [Italic],
  fromMarkdown: {
    emphasis: (node, context) => {
      const marks = withMark(context, context.schema.marks.italic?.create());
      return marks && context.inlines(node, marks);
    },
  },
  marks: {
    italic: {
      open: (_, context) => delimiter(context, 'emphasis', '*'),
      close: (_, context) => delimiter(context, 'emphasis', '*'),
      flanking: true,
    },
  },
  styles: {
    emphasis: {
      default: '*',
      detect: { emphasis: (_, source) => source.charAt(0) },
    },
  },
});

const strongNotation = defineNotation({
  name: 'strong',
  extensions: [Bold],
  fromMarkdown: {
    strong: (node, context) => {
      const marks = withMark(context, context.schema.marks.bold?.create());
      return marks && context.inlines(node, marks);
    },
  },
  marks: {
    bold: {
      open: (_, context) => delimiter(context, 'strong', '**'),
      close: (_, context) => delimiter(context, 'strong', '**'),
      flanking: true,
    },
  },
  styles: {
    strong: {
      default: '**',
      detect: { strong: (_, source) => source.slice(0, 2) },
    },
  },
});

function codeSpan(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  const fence = '`'.repeat(longest + 1);
  // Markdown strips one space from both ends when both are there.
  const pad =
    /^`|`$/.test(text) || (/^ .*[^ ].* $/s.test(text) && text.length > 2)
      ? ' '
      : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const inlineCodeNotation = defineNotation({
  name: 'inlineCode',
  extensions: [Code],
  fromMarkdown: {
    inlineCode: (node, context) => {
      const marks = withMark(context, context.schema.marks.code?.create());
      return marks && context.text(node.value, marks);
    },
  },
  marks: {
    code: { open: '', close: '', run: (text) => codeSpan(text) },
  },
});

// Conservative subset of what both marked and VFM (remark-parse with `gfm`)
// autolink: no characters they treat specially at the edges or inside.
const BARE_URL_RE = /^https?:\/\/[^\s<>&"'`\\()[\]{}]+$/i;
const TRIMMED_TRAILING_RE = /[.,:;!?*_~]$/;

function isPlainText(node: ProseMirrorNode | undefined): boolean {
  return Boolean(node?.isText && node.marks.length === 0);
}

function isBoundaryBefore(previous: ProseMirrorNode | undefined): boolean {
  if (!previous || previous.type.name === 'hardBreak') {
    return true;
  }
  return isPlainText(previous) && /\s$/.test(previous.text ?? '');
}

function isBoundaryAfter(
  next: ProseMirrorNode | undefined,
  afterNext: ProseMirrorNode | undefined,
): boolean {
  if (!next || next.type.name === 'hardBreak') {
    return true;
  }
  if (!isPlainText(next)) {
    return false;
  }
  const text = next.text ?? '';
  if (/^\s/.test(text)) {
    return true;
  }
  // Parsers drop one sentence mark from the end of a URL, so "url." still
  // links only "url" as long as nothing else is glued on after the mark.
  if (/^[.,:;!?]\s/.test(text)) {
    return true;
  }
  return (
    /^[.,:;!?]$/.test(text) &&
    (!afterNext || afterNext.type.name === 'hardBreak')
  );
}

/**
 * A link whose text is its URL, where the bare URL autolinks back to the
 * same link, so it is written as `https://…` instead of `[https://…](…)`.
 */
export function isBareUrlLink({ node, previous, next, afterNext }: InlineRun) {
  if (!node.isText || node.marks.length !== 1) {
    return false;
  }
  const [mark] = node.marks;
  const text = node.text ?? '';
  return (
    mark.type.name === 'link' &&
    !mark.attrs.title &&
    mark.attrs.href === text &&
    BARE_URL_RE.test(text) &&
    !TRIMMED_TRAILING_RE.test(text) &&
    isBoundaryBefore(previous) &&
    isBoundaryAfter(next, afterNext)
  );
}

const linkNotation = defineNotation({
  name: 'link',
  extensions: [Link],
  fromMarkdown: {
    link: (node, context) => {
      const marks = withMark(
        context,
        context.schema.marks.link?.create({
          href: node.url,
          title: node.title ?? null,
        }),
      );
      return marks && context.inlines(node, marks);
    },
  },
  marks: {
    link: {
      open: '[',
      close: (mark) =>
        `](${linkDestination(String(mark.attrs.href ?? ''))}${linkTitle(mark.attrs.title)})`,
      implied: isBareUrlLink,
    },
  },
});

/** CommonMark, as definitions of the editor's standard nodes and marks. */
export function commonMarkNotations({
  image,
}: {
  image: AnyExtension;
}): NotationDefinition[] {
  return [
    documentNotation,
    paragraphNotation,
    headingNotation,
    thematicBreakNotation,
    blockquoteNotation,
    listNotation,
    codeBlockNotation,
    hardBreakNotation,
    imageNotation(image),
    emphasisNotation,
    strongNotation,
    inlineCodeNotation,
    linkNotation,
  ];
}
