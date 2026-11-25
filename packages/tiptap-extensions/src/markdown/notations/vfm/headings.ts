import { Extension, InputRule, Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { decodeString } from 'micromark-util-decode-string';

import { touchesNodes } from '../../changes';
import { hasDocumentNotation } from '../../extension';
import { childrenOf, type UnknownMdastNode } from '../../mdast';
import { transformPlugin } from '../../micromark';
import { defineNotation, type WriteContext } from '../../notation';
import {
  attributesAt,
  formatAttributes,
  type InlineAttributes,
  renderedAttributes,
  writableAttributes,
} from './attributes';
import { Slugger } from './slug';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingAttributes: {
      /**
       * Gives the heading the selection is in the attributes, or takes them
       * away with `null`.
       */
      setHeadingAttributes: (attributes: InlineAttributes | null) => ReturnType;
    };
    sectionEnd: {
      /** Inserts a line that ends the section of the level. */
      insertSectionEnd: (level: number) => ReturnType;
    };
  }
}

interface HeadingMdast extends UnknownMdastNode {
  depth?: number;
  attributes?: InlineAttributes;
  /** `{…}` was on the line after, where VFM sections ignore closing hashes. */
  nextLine?: boolean;
}

// The named character references that remark 8 also reads without the
// semicolon, as HTML does.
const LEGACY_REFERENCES =
  'AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml Yacute aacute acirc acute aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl igrave iquest iuml laquo lt macr micro middot nbsp not ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg sect shy sup1 sup2 sup3 szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml'.split(
    ' ',
  );

function characterReferenceEnd(text: string, index: number): number {
  const rest = text.slice(index);
  const numeric = rest.match(/^&#(?:[xX][\da-fA-F]+|\d+);?/)?.[0];
  if (numeric) {
    return index + numeric.length;
  }
  const named = rest.match(/^&[A-Za-z][A-Za-z\d]*;/)?.[0];
  if (named && decodeString(named) !== named) {
    return index + named.length;
  }
  const word = rest.match(/^&([A-Za-z\d]+)/)?.[1] ?? '';
  let longest = 0;
  for (const name of LEGACY_REFERENCES) {
    if (name.length > longest && word.startsWith(name)) {
      longest = name.length;
    }
  }
  return longest > 0 ? index + 1 + longest : -1;
}

/** The end of a reference at `index`, as remark 8 reads one, or -1. */
function bracketReferenceEnd(text: string, index: number): number {
  let at = text[index] === '!' ? index + 1 : index;
  if (text[at] !== '[') {
    return -1;
  }
  const call = text.slice(at).match(/^\[\^[^\s\]]+\]/)?.[0];
  if (call) {
    return at + call.length;
  }
  if (text[at + 1] === '^') {
    return -1;
  }
  const open = ++at;
  let depth = 0;
  let bracketed = false;
  for (; at < text.length; at++) {
    const char = text[at];
    if (char === '\\') {
      at++;
    } else if (char === '[') {
      bracketed = true;
      depth++;
    } else if (char === ']') {
      if (depth === 0) {
        break;
      }
      depth--;
    }
  }
  if (text[at] !== ']') {
    return -1;
  }
  const empty = at === open;
  at++;
  let full = false;
  if (text[at] === '[') {
    at++;
    let end = at;
    while (end < text.length && text[end] !== '[' && text[end] !== ']') {
      end += text[end] === '\\' ? 2 : 1;
    }
    if (text[end] === ']') {
      full = end > at;
      at = end + 1;
    }
  } else if (empty) {
    return -1;
  }
  return !full && bracketed ? -1 : at;
}

/**
 * Where remark 8, which VFM 2 reads markdown with, starts the text node that
 * ends `text`, the source of text with no syntax micromark reads: escapes,
 * character references and references are nodes of their own there.
 */
function remarkTextStart(text: string): number {
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    let end = -1;
    if (char === '\\' && /[!-/:-@[-`{-~]/.test(text[index + 1] ?? '')) {
      end = index + 2;
    } else if (char === '&') {
      end = characterReferenceEnd(text, index);
    } else if (char === '[' || (char === '!' && text[index + 1] === '[')) {
      end = bracketReferenceEnd(text, index);
    }
    if (end !== -1) {
      start = end;
      index = end - 1;
    }
  }
  return start;
}

/**
 * The attributes that end `text`, the source of a heading's last text node
 * as remark 8 has it, and where they start: VFM reads them from the last
 * `{`, where the text has more than whitespace before it.
 */
function trailingAttributes(
  text: string,
): { attributes: InlineAttributes; start: number } | null {
  const value = text.trimEnd();
  const start = value.lastIndexOf('{');
  const found = start > 0 ? attributesAt(value, start) : null;
  return found && found.end === value.length && /\S/.test(value.slice(0, start))
    ? { attributes: found.attributes, start }
    : null;
}

/** Whether VFM reads `{…}` written after `text` on its line as `attributes`. */
function readsOnSameLine(
  text: string,
  written: string,
  attributes: InlineAttributes,
): boolean {
  const line = `${text} ${written}`;
  const found = trailingAttributes(line.slice(remarkTextStart(line)));
  return JSON.stringify(found?.attributes) === JSON.stringify(attributes);
}

function isAtx(node: UnknownMdastNode, source: string): boolean {
  const { start, end } = node.position ?? {};
  return (
    start?.offset !== undefined &&
    end?.offset !== undefined &&
    !source.slice(start.offset, end.offset).includes('\n')
  );
}

function sameLineAttributes(heading: HeadingMdast, source: string): boolean {
  const last = childrenOf(heading).at(-1);
  const start = last?.position?.start.offset;
  const end = last?.position?.end.offset;
  if (last?.type !== 'text' || start === undefined || end === undefined) {
    return false;
  }
  const text = source.slice(start, end);
  const textStart = remarkTextStart(text);
  const found = trailingAttributes(text.slice(textStart));
  if (!found) {
    return false;
  }
  const kept = text.slice(0, textStart + found.start).trimEnd();
  last.value = decodeString(kept);
  last.position = {
    start: last.position?.start ?? { line: 0, column: 0 },
    end: {
      line: last.position?.end.line ?? 0,
      column: (last.position?.start.column ?? 0) + kept.length,
      offset: start + kept.length,
    },
  };
  heading.attributes = found.attributes;
  return true;
}

function pointAt(source: string, offset: number, line: number) {
  return {
    line,
    column: offset - source.lastIndexOf('\n', offset - 1),
    offset,
  };
}

/**
 * `{…}` at the start of the line after an ATX heading, the first line of a
 * paragraph that starts where the heading does, is the heading's: VFM reads
 * it as written and leaves the rest to the paragraph. It drops one after
 * attributes on the heading's own line.
 */
function nextLineAttributes(
  parent: UnknownMdastNode,
  index: number,
  source: string,
  dropped: boolean,
): void {
  const children = childrenOf(parent);
  const heading = children[index] as HeadingMdast;
  const next = children[index + 1];
  const headingStart = heading.position?.start;
  const start = next?.position?.start;
  const end = next?.position?.end;
  const first = childrenOf(next ?? { type: '' })[0];
  const firstEnd = first?.position?.end.offset;
  if (
    next?.type !== 'paragraph' ||
    !headingStart ||
    !end ||
    start?.offset === undefined ||
    start.line !== (heading.position?.end.line ?? 0) + 1 ||
    start.column !== headingStart.column ||
    first?.type !== 'text' ||
    first.position?.start.offset !== start.offset ||
    firstEnd === undefined
  ) {
    return;
  }
  const lineEnd = source.indexOf('\n', start.offset);
  const line = source.slice(
    start.offset,
    lineEnd === -1 ? source.length : lineEnd,
  );
  const found = attributesAt(line, 0);
  if (!found) {
    return;
  }
  const text = first.value ?? '';
  const restOfLine = line.slice(found.end);
  let rest: { offset: number; line: number; value: string } | null = null;
  if (/\S/.test(restOfLine)) {
    const read = decodeString(line.slice(0, found.end));
    if (!text.startsWith(read)) {
      return;
    }
    rest = {
      offset: start.offset + found.end,
      line: start.line,
      value: text.slice(read.length),
    };
  } else if (end.line !== start.line) {
    // A line that ends in other syntax, like a hard break, is left alone.
    if (firstEnd <= lineEnd) {
      return;
    }
    const after = source.slice(lineEnd + 1).match(/^[ \t>]*/)?.[0] ?? '';
    rest = {
      offset: lineEnd + 1 + after.length,
      line: start.line + 1,
      value: text.slice(text.indexOf('\n') + 1),
    };
  }
  if (!dropped) {
    heading.attributes = found.attributes;
  }
  heading.nextLine = true;
  const headingEnd = start.offset + (rest ? found.end : line.length);
  heading.position = {
    start: headingStart,
    end: pointAt(source, Math.min(headingEnd, end.offset ?? 0), start.line),
  };
  if (!rest) {
    children.splice(index + 1, 1);
    return;
  }
  const restStart = pointAt(source, rest.offset, rest.line);
  next.position = { start: restStart, end };
  if (rest.value === '' && firstEnd <= rest.offset) {
    next.children = childrenOf(next).slice(1);
  } else {
    first.value = rest.value;
    first.position = { start: restStart, end: first.position?.end ?? end };
  }
}

/** Whether a list item's marker is alone on its line, with nothing after. */
function isBareItem(item: UnknownMdastNode, source: string): boolean {
  const start = item.position?.start.offset;
  return (
    start !== undefined &&
    /^(?:[-*+]|\d{1,9}[.)])(?:\n|$)/.test(source.slice(start))
  );
}

function readHeadingAttributes(tree: UnknownMdastNode, source: string): void {
  // VFM reads the lines in a list item whose marker is alone on its line
  // with a space more than the item's content has, so `{` does not start
  // the line after a heading there.
  const visit = (parent: UnknownMdastNode, bareItem: boolean) => {
    const children = childrenOf(parent);
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child.type === 'heading') {
        if (isAtx(child, source)) {
          const own = sameLineAttributes(child as HeadingMdast, source);
          if (!bareItem) {
            nextLineAttributes(parent, index, source, own);
          }
        }
      } else {
        visit(
          child,
          child.type === 'listItem'
            ? isBareItem(child, source)
            : child.type !== 'blockquote' && bareItem,
        );
      }
    }
  };
  visit(tree, false);
}

function attributesOf(node: ProseMirrorNode): InlineAttributes | null {
  const { attributes } = node.attrs;
  return attributes &&
    typeof attributes === 'object' &&
    Object.keys(attributes).length > 0
    ? (attributes as InlineAttributes)
    : null;
}

/**
 * Whether VFM reads `{…}` after the heading's content on its line: the
 * content has to end with text that is not only whitespace.
 */
function takesSameLineAttributes(node: ProseMirrorNode): boolean {
  const last = node.lastChild;
  return Boolean(
    last?.isText && last.marks.length === 0 && /\S/.test(last.text ?? ''),
  );
}

/**
 * The closing sequence as VFM reads it: one before attributes that have to
 * go on the next line does not keep the heading from opening a section.
 */
function closingOf(node: ProseMirrorNode): string {
  const closing = node.attrs.closingSequence;
  return typeof closing === 'string' &&
    (!attributesOf(node) || takesSameLineAttributes(node))
    ? closing
    : '';
}

function writeHeading(node: ProseMirrorNode, context: WriteContext): string {
  const attributes = attributesOf(node) ?? {};
  const written = formatAttributes(attributes) ?? '';
  const level = Number(node.attrs.level) || 1;
  const closing = closingOf(node);
  const line = context
    .inline(node, { singleLine: true })
    .replaceAll('\n', '&#10;');
  const head = `${'#'.repeat(level)}${line ? ` ${line}` : ''}`;
  const last = node.lastChild;
  // Escapes and references in the text before them hide them from VFM.
  const sameLine =
    last !== null &&
    takesSameLineAttributes(node) &&
    readsOnSameLine(
      context.inline(node.type.create(node.attrs, last), { singleLine: true }),
      written,
      attributes,
    );
  const base = context.base?.text;
  const nextLine =
    !sameLine ||
    (!closing &&
      base != null &&
      /^[ \t]*#[^\n]*\n\{[^\n]*\}[ \t]*$/.test(base));
  return nextLine ? `${head}\n${written}` : `${head} ${written}${closing}`;
}

const HeadingAttributes = Extension.create({
  name: 'headingAttributes',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          attributes: {
            default: null,
            parseHTML: () => null,
            // The id that VFM gives the heading comes from a decoration.
            renderHTML: (attrs) => renderedAttributes(attrs.attributes),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setHeadingAttributes:
        (attributes) =>
        ({ editor, state, tr, dispatch }) => {
          if (!hasDocumentNotation(editor, this.name)) {
            return false;
          }
          const { $from } = state.selection;
          if ($from.parent.type.name !== 'heading') {
            return false;
          }
          const written =
            attributes && Object.keys(attributes).length > 0
              ? writableAttributes(attributes)
              : null;
          // Attributes that have to go on the next line would make a heading
          // with a closing sequence open a section.
          if (
            (attributes && Object.keys(attributes).length > 0 && !written) ||
            (written && $from.parent.content.size === 0) ||
            (written &&
              $from.parent.attrs.closingSequence &&
              !takesSameLineAttributes($from.parent))
          ) {
            return false;
          }
          dispatch?.(
            tr.setNodeMarkup($from.before(), undefined, {
              ...$from.parent.attrs,
              attributes: written,
            }),
          );
          return true;
        },
    };
  },

  // `{…}` typed at the end of a heading, where VFM reads it, becomes its
  // attributes.
  addInputRules() {
    return [
      new InputRule({
        find: /(?<!\\)([ \t]*)(\{[^{}\n]*\})$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          const heading = $from.parent;
          const found = attributesAt(match[2] ?? '', 0);
          const before = state.doc.textBetween(
            $from.start(),
            range.from,
            undefined,
            '\ufffc',
          );
          if (
            heading.type.name !== 'heading' ||
            !hasDocumentNotation(this.editor, this.name) ||
            range.to !== $from.end() ||
            !found ||
            found.end !== (match[2] ?? '').length ||
            !/\S/.test(before) ||
            $from.nodeBefore?.isText !== true ||
            $from.nodeBefore.marks.length > 0
          ) {
            return null;
          }
          const written = writableAttributes(found.attributes);
          if (!written) {
            return null;
          }
          const { tr } = state;
          tr.delete(range.from, range.to);
          tr.setNodeMarkup($from.before(), undefined, {
            ...heading.attrs,
            attributes: Object.keys(written).length > 0 ? written : null,
          });
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [headingIdsPlugin()];
  },
});

export const headingAttributesNotation = defineNotation({
  name: 'headingAttributes',
  version: 1,
  extensions: [HeadingAttributes],
  attributes: ['heading:attributes'],
  remarkPlugins: [transformPlugin(readHeadingAttributes)],
  fromMarkdown: {
    heading: (node, context, next) => {
      const { attributes, nextLine } = node as HeadingMdast;
      const result = next();
      if ((!attributes && !nextLine) || !result || Array.isArray(result)) {
        return result;
      }
      const heading = result as ProseMirrorNode;
      if (heading.type.name !== 'heading') {
        return result;
      }
      // VFM sections a heading with `{…}` on the line after whatever closing
      // sequence it has, which is left out where the heading is written anew.
      const closing = nextLine
        ? null
        : (context.source(node).match(/[ \t]+#+[ \t]*$/)?.[0] ?? null);
      return heading.type.create(
        {
          ...heading.attrs,
          closingSequence: closing,
          attributes: attributes ?? null,
        },
        heading.content,
        heading.marks,
      );
    },
  },
  nodes: {
    heading: {
      write: (node, context, next) =>
        attributesOf(node) ? writeHeading(node, context) : next(),
      writtenAttrs: (attrs, node) => {
        const { attributes } = attrs;
        const written =
          attributes &&
          typeof attributes === 'object' &&
          Object.keys(attributes).length > 0
            ? writableAttributes(attributes as InlineAttributes)
            : null;
        return {
          ...attrs,
          closingSequence: closingOf(node) || null,
          attributes: written,
        };
      },
    },
  },
});

/** The text of a heading that VFM makes its id of. */
export function headingText(node: ProseMirrorNode): string {
  let text = '';
  const visit = (parent: ProseMirrorNode) => {
    parent.forEach((child) => {
      if (child.isText) {
        text += child.text ?? '';
      } else if (child.type.name === 'inlineImage') {
        text += String(child.attrs.alt ?? '');
      } else if (child.type.name !== 'inlineFootnote' && !child.isAtom) {
        visit(child);
      }
    });
  };
  visit(node);
  return withoutTags(text);
}

/** The text without what looks like HTML tags, as VFM leaves them out. */
function withoutTags(text: string): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      break;
    }
    const close = text.indexOf('>', open + 1);
    const next = text.indexOf('<', open + 1);
    if (close === -1) {
      break;
    }
    if (next !== -1 && next < close) {
      result += text.slice(index, next);
      index = next;
      continue;
    }
    result += text.slice(index, open);
    index = close + 1;
  }
  return result + text.slice(index);
}

export interface DocumentId {
  id: string;
  /** What has the id: a heading, a figure, an image in text or code. */
  kind: 'heading' | 'figure' | 'image' | 'code';
  pos: number;
  node: ProseMirrorNode;
  /** The id was given in the markdown, rather than made of a heading. */
  explicit: boolean;
}

function explicitId(attributes: unknown): string | null {
  const id = (attributes as InlineAttributes | null)?.id;
  return typeof id === 'string' && id ? id : null;
}

/** What follows the first word of an info string and the blanks after it. */
function metaOf(info: string): string {
  const word = info.match(/^[ \t]*/)?.[0].length ?? 0;
  let index = word;
  while (index < info.length && info[index] !== ' ' && info[index] !== '\t') {
    index++;
  }
  if (index === word) {
    return '';
  }
  const start = index;
  while (info[index] === ' ' || info[index] === '\t') {
    index++;
  }
  return index === start ? '' : info.slice(index);
}

/** The `{#id}` among the attributes of a code block's info string. */
export function codeBlockId(info: unknown): string | null {
  return explicitId(codeBlockAttributes(info));
}

/**
 * The attributes of the first `{…}` in the meta of an info string, after
 * whitespace and outside quotes, as VFM finds them.
 */
export function codeBlockAttributes(info: unknown): InlineAttributes | null {
  if (typeof info !== 'string') {
    return null;
  }
  const meta = metaOf(info);
  if (!meta) {
    return null;
  }
  let quoted = false;
  for (let index = 0; index < meta.length; index++) {
    const char = meta[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (
      char === '{' &&
      !quoted &&
      (index === 0 || /\s/.test(meta[index - 1]))
    ) {
      const found = attributesAt(meta, index);
      if (found && Object.keys(found.attributes).length > 0) {
        return found.attributes;
      }
    }
  }
  return null;
}

/**
 * The ids VFM gives the document's headings, figures, images and code, in
 * the order of the document: a heading's own id, or one made of its text,
 * numbered where it repeats.
 */
export function documentIds(doc: ProseMirrorNode): DocumentId[] {
  const ids: DocumentId[] = [];
  const slugger = new Slugger();
  const ends = sectionEnds(doc);
  doc.descendants((node, pos) => {
    switch (node.type.name) {
      case 'heading': {
        const own = explicitId(node.attrs.attributes);
        ids.push({
          id: own ? slugger.slug(own, true) : slugger.slug(headingText(node)),
          kind: 'heading',
          pos,
          node,
          explicit: Boolean(own),
        });
        return false;
      }
      case 'sectionEnd': {
        // VFM reads the line as an empty heading before it ends a section,
        // and it stays one where it ends none.
        const id = slugger.slug('');
        if (!ends.get(pos)) {
          ids.push({ id, kind: 'heading', pos, node, explicit: false });
        }
        return false;
      }
      case 'image':
      case 'inlineImage': {
        const own = explicitId(node.attrs.attributes);
        if (own) {
          ids.push({
            id: own,
            kind: node.type.name === 'image' ? 'figure' : 'image',
            pos,
            node,
            explicit: true,
          });
        }
        return false;
      }
      case 'codeBlock': {
        const own = codeBlockId(node.attrs.language);
        if (own) {
          ids.push({ id: own, kind: 'code', pos, node, explicit: true });
        }
        return false;
      }
      default:
        return true;
    }
  });
  return ids;
}

const headingIdsKey = new PluginKey<DecorationSet>('headingIds');

const isHeading = (node: ProseMirrorNode) =>
  node.type.name === 'heading' || node.type.name === 'sectionEnd';

// The ids and the sections depend on the headings alone, and on their text.
function touchesHeadings(tr: Transaction): boolean {
  return touchesNodes(tr, isHeading, isHeading);
}

function headingIdDecorations(doc: ProseMirrorNode): DecorationSet {
  return DecorationSet.create(
    doc,
    documentIds(doc)
      .filter((it) => it.kind === 'heading')
      .map((it) =>
        Decoration.node(it.pos, it.pos + it.node.nodeSize, { id: it.id }),
      ),
  );
}

// The ids depend on every heading before, so they are decorations rather
// than attributes the heading renders.
function headingIdsPlugin(): Plugin {
  return new Plugin({
    key: headingIdsKey,
    state: {
      init: (_, { doc }) => headingIdDecorations(doc),
      apply: (tr, set) =>
        !tr.docChanged
          ? set
          : touchesHeadings(tr)
            ? headingIdDecorations(tr.doc)
            : set.map(tr.mapping, tr.doc),
    },
    props: {
      decorations: (state) => headingIdsKey.getState(state),
    },
  });
}

/**
 * The heading each line that ends a section ends, by the line's position,
 * as VFM sections the top level: a heading opens a section unless its
 * closing sequence is as long as its level, and any heading ends the open
 * sections of its level and deeper.
 */
export function sectionEnds(
  doc: ProseMirrorNode,
): Map<number, ProseMirrorNode | null> {
  const ends = new Map<number, ProseMirrorNode | null>();
  const open: (ProseMirrorNode | null)[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name !== 'heading' && node.type.name !== 'sectionEnd') {
      return;
    }
    const level = Number(node.attrs.level) || 1;
    if (node.type.name === 'sectionEnd') {
      const ended = open[level];
      ends.set(pos, ended ?? null);
      open.length = Math.min(open.length, level);
      // One that ends nothing is an empty heading, and opens a section.
      if (ended === undefined) {
        open[level] = node;
      }
      return;
    }
    open.length = Math.min(open.length, level);
    const closing = closingOf(node).trim().length;
    if (closing < level) {
      open[level] = node;
    }
  });
  return ends;
}

const sectionEndsKey = new PluginKey<DecorationSet>('sectionEnds');

function sectionEndDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  for (const [pos, ended] of sectionEnds(doc)) {
    const node = doc.nodeAt(pos);
    if (!node) {
      continue;
    }
    decorations.push(
      Decoration.node(
        pos,
        pos + node.nodeSize,
        ended
          ? {
              'data-ends': headingText(ended) || '#',
              'data-ends-level': String(ended.attrs.level),
            }
          : { 'data-ends-nothing': '' },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

export const SectionEnd = Node.create({
  name: 'sectionEnd',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (element) =>
          Number(element.getAttribute('data-section-end')) || 1,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-section-end]' }];
  },

  renderText({ node }) {
    return '#'.repeat(Number(node.attrs.level) || 1);
  },

  // VFM writes nothing for the line. What it ends is shown as decorations,
  // since that depends on the headings before it.
  renderHTML({ node }) {
    return ['div', { 'data-section-end': String(node.attrs.level ?? 1) }];
  },

  addCommands() {
    return {
      insertSectionEnd:
        (level) =>
        ({ editor, commands }) =>
          hasDocumentNotation(editor, this.name) &&
          level >= 1 &&
          level <= 6 &&
          commands.insertContent({ type: this.name, attrs: { level } }),
    };
  },

  // A paragraph of hashes alone is the line, as Enter ends it.
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        const text = $from.parent.textContent;
        if (
          !empty ||
          $from.parent.type.name !== 'paragraph' ||
          $from.parentOffset !== $from.parent.content.size ||
          !/^#{1,6}$/.test(text) ||
          text.length !== $from.parent.content.size ||
          !hasDocumentNotation(this.editor, this.name)
        ) {
          return false;
        }
        return this.editor.commands.command(({ tr, dispatch }) => {
          const paragraph = state.schema.nodes.paragraph?.create();
          if (!paragraph) {
            return false;
          }
          if (dispatch) {
            const start = $from.before();
            tr.replaceWith(start, $from.after(), [
              this.type.create({ level: text.length }),
              paragraph,
            ]);
            tr.setSelection(TextSelection.create(tr.doc, start + 2));
          }
          return true;
        });
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sectionEndsKey,
        state: {
          init: (_, { doc }) => sectionEndDecorations(doc),
          apply: (tr, set) =>
            !tr.docChanged
              ? set
              : touchesHeadings(tr)
                ? sectionEndDecorations(tr.doc)
                : set.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => sectionEndsKey.getState(state),
        },
      }),
    ];
  },
});

function isSectionEndLine(node: HeadingMdast, source: string): boolean {
  return (
    !node.attributes &&
    childrenOf(node).length === 0 &&
    /^#+$/.test(source.trim()) &&
    source.trim().length === node.depth
  );
}

export const sectionEndNotation = defineNotation({
  name: 'sectionEnd',
  version: 1,
  extensions: [SectionEnd],
  fromMarkdown: {
    heading: (node, context, next) =>
      isSectionEndLine(node as HeadingMdast, context.source(node))
        ? context.schema.nodes.sectionEnd?.create({ level: node.depth })
        : next(),
  },
  nodes: {
    sectionEnd: (node) => '#'.repeat(Number(node.attrs.level) || 1),
    heading: {
      write: (_, __, next) => next(),
      // An empty heading is written as a line of hashes, which is what VFM
      // ends a section with, and an empty heading where none is open.
      writtenAs: (node) =>
        node.content.size === 0 &&
        !node.attrs.closingSequence &&
        !attributesOf(node)
          ? { type: 'sectionEnd', attrs: { level: node.attrs.level } }
          : null,
    },
  },
});
