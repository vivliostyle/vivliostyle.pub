import { Extension, InputRule, Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { decodeString } from 'micromark-util-decode-string';

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
}

function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    count++;
  }
  return count % 2 === 1;
}

/**
 * The attributes that end `source`, the source of a heading's last text,
 * and where they start. VFM only reads them where the text has more than
 * whitespace before them.
 */
function trailingAttributes(
  source: string,
): { attributes: InlineAttributes; start: number } | null {
  const end = source.trimEnd().length;
  for (let start = source.lastIndexOf('{'); start > 0; ) {
    const found = attributesAt(source, start);
    if (
      found &&
      found.end === end &&
      !isEscaped(source, start) &&
      /\S/.test(source.slice(0, start))
    ) {
      return { attributes: found.attributes, start };
    }
    start = source.lastIndexOf('{', start - 1);
  }
  return null;
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
  const found = trailingAttributes(text);
  if (!found) {
    return false;
  }
  const kept = text.slice(0, found.start).trimEnd();
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

/**
 * `{…}` on the line after an ATX heading, as the first line of a paragraph
 * that starts where the heading does, is the heading's.
 */
function nextLineAttributes(
  parent: UnknownMdastNode,
  index: number,
  source: string,
): void {
  const children = childrenOf(parent);
  const heading = children[index] as HeadingMdast;
  const next = children[index + 1];
  const headingEnd = heading.position?.end;
  const start = next?.position?.start;
  const first = childrenOf(next ?? { type: '' })[0];
  if (
    next?.type !== 'paragraph' ||
    !headingEnd ||
    start?.offset === undefined ||
    start.line !== headingEnd.line + 1 ||
    start.column !== heading.position?.start.column ||
    first?.type !== 'text' ||
    first.position?.start.offset !== start.offset
  ) {
    return;
  }
  const lineEnd = source.indexOf('\n', start.offset);
  const line = source.slice(
    start.offset,
    lineEnd === -1 ? source.length : lineEnd,
  );
  const found = attributesAt(line, 0);
  if (!found || found.end !== line.trimEnd().length) {
    return;
  }
  const paragraphEnd = next.position?.end;
  const firstEnd = first.position?.end.offset ?? 0;
  if (!paragraphEnd || paragraphEnd.line === start.line) {
    heading.attributes = found.attributes;
    heading.position = {
      start: heading.position?.start ?? headingEnd,
      end: paragraphEnd ?? headingEnd,
    };
    children.splice(index + 1, 1);
    return;
  }
  // Only at the top level do the paragraph's lines start without a prefix.
  if (parent.type !== 'root' || firstEnd <= lineEnd) {
    return;
  }
  heading.attributes = found.attributes;
  // The rest of the paragraph stays one, from the line after.
  heading.position = {
    start: heading.position?.start ?? headingEnd,
    end: {
      line: start.line,
      column: start.column + line.length,
      offset: start.offset + line.length,
    },
  };
  const rest = lineEnd + 1;
  const restStart = {
    line: start.line + 1,
    column: rest - source.lastIndexOf('\n', rest - 1),
    offset: rest,
  };
  next.position = { start: restStart, end: paragraphEnd };
  const text = first.value ?? '';
  first.value = text.slice(text.indexOf('\n') + 1);
  first.position = {
    start: restStart,
    end: first.position?.end ?? paragraphEnd,
  };
}

function readHeadingAttributes(tree: UnknownMdastNode, source: string): void {
  const visit = (parent: UnknownMdastNode) => {
    const children = childrenOf(parent);
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child.type === 'heading') {
        if (
          isAtx(child, source) &&
          !sameLineAttributes(child as HeadingMdast, source)
        ) {
          nextLineAttributes(parent, index, source);
        }
      } else {
        visit(child);
      }
    }
  };
  visit(tree);
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

function writeHeading(node: ProseMirrorNode, context: WriteContext): string {
  const attributes = attributesOf(node);
  const written = attributes && formatAttributes(attributes);
  const level = Number(node.attrs.level) || 1;
  const closing =
    typeof node.attrs.closingSequence === 'string'
      ? node.attrs.closingSequence
      : '';
  const line = context
    .inline(node, { singleLine: true })
    .replaceAll('\n', '&#10;');
  const head = `${'#'.repeat(level)}${line ? ` ${line}` : ''}`;
  const base = context.base?.text;
  const nextLine =
    !takesSameLineAttributes(node) ||
    (base != null && /^[ \t]*#[^\n]*\n\{[^\n]*\}[ \t]*$/.test(base));
  return nextLine
    ? `${head}${closing}\n${written}`
    : `${head} ${written}${closing}`;
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
          if (
            (attributes && Object.keys(attributes).length > 0 && !written) ||
            (written && $from.parent.content.size === 0)
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
      const { attributes } = node as HeadingMdast;
      const result = next();
      if (!attributes || !result || Array.isArray(result)) {
        return result;
      }
      const heading = result as ProseMirrorNode;
      if (heading.type.name !== 'heading') {
        return result;
      }
      // Attributes on the next line are not where the closing sequence is.
      const firstLine = context.source(node).split('\n')[0];
      const closing = firstLine.match(/[ \t]+#+[ \t]*$/)?.[0] ?? null;
      return heading.type.create(
        { ...heading.attrs, closingSequence: closing, attributes },
        heading.content,
        heading.marks,
      );
    },
  },
  nodes: {
    heading: {
      write: (node, context, next) =>
        attributesOf(node) ? writeHeading(node, context) : next(),
      writtenAttrs: (attrs) => {
        const { attributes } = attrs;
        const written =
          attributes &&
          typeof attributes === 'object' &&
          Object.keys(attributes).length > 0
            ? writableAttributes(attributes as InlineAttributes)
            : null;
        return { ...attrs, attributes: written };
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
  return text.replace(/<[^<>]*>/g, '');
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
  const meta = info.match(/^[ \t]*[^ \t]+[ \t]+(.*)$/)?.[1];
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
      apply: (tr, set) => (tr.docChanged ? headingIdDecorations(tr.doc) : set),
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
    const closing = String(node.attrs.closingSequence ?? '').trim().length;
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
            tr.docChanged ? sectionEndDecorations(tr.doc) : set,
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
