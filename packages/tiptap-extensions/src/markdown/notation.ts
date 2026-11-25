import {
  type Extensions,
  Mark as MarkExtension,
  Node as NodeExtension,
} from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import type { Pluggable } from 'unified';

import type { BaseNode } from './base';
import type { MdastNodeOf, MdastType, UnknownMdastNode } from './mdast';
import type { LinePrefix } from './source';

/**
 * What a handler made of an mdast node. `undefined` leaves the node to the
 * next definition that handles its type, and in the end to the raw fallback,
 * which keeps its source as written.
 */
export type FromMarkdownResult =
  | ProseMirrorNode
  | readonly ProseMirrorNode[]
  | null
  | undefined;

export interface ParseContext {
  readonly schema: Schema;
  /** The marks the phrasing being converted is under. */
  readonly marks: readonly Mark[];
  /** The node as written, without the prefixes of the containers around it. */
  source(node: UnknownMdastNode): string;
  /** Where the node starts in its line, counted from 0. */
  column(node: UnknownMdastNode): number;
  blocks(parent: UnknownMdastNode): ProseMirrorNode[];
  inlines(parent: UnknownMdastNode, marks?: readonly Mark[]): ProseMirrorNode[];
  text(value: string, marks?: readonly Mark[]): ProseMirrorNode[];
  /**
   * A text node as text, keeping backslash escapes of characters no
   * definition gives meaning as raw markdown.
   */
  literal(node: UnknownMdastNode): ProseMirrorNode[];
  /** Keeps the node's source as written, as the raw fallback does. */
  raw(node: UnknownMdastNode): ProseMirrorNode[];
  /** Converts the content of a container whose lines carry `prefix`. */
  within<T>(prefix: LinePrefix, convert: () => T): T;
}

/**
 * `next` converts the node as the definition registered before this one
 * would, so a definition can adjust another's result instead of replacing it.
 */
type Handler<Node> = {
  bivarianceHack(
    node: Node,
    context: ParseContext,
    next: () => FromMarkdownResult,
  ): FromMarkdownResult;
}['bivarianceHack'];

export type FromMarkdownHandler = Handler<UnknownMdastNode>;

export type FromMarkdownHandlers = {
  [Type in MdastType]?: Handler<MdastNodeOf<Type>>;
} & Record<string, FromMarkdownHandler | undefined>;

export interface WriteContext {
  readonly schema: Schema;
  /** The writing style the source uses most for `key`, see `StyleSpec`. */
  style(key: string): string;
  /**
   * `minimal` writes text with only the escapes the writer chose: where the
   * output read back differently, it escapes the characters that made the
   * difference. `safe` is the last resort, escaping every character that
   * could mean something.
   */
  readonly escaping: 'minimal' | 'safe';
  /** Data the container passes to the child being written. */
  readonly data: Readonly<Record<string, unknown>>;
  /** List markers the block must not use, or it would merge with a neighbour. */
  readonly avoidMarkers: ReadonlySet<string>;
  /** The node's source before it changed, when it had one. */
  readonly base: BaseNode | null;
  /** For an inline node, what is written on its line before it. */
  readonly lineBefore?: string;
  /**
   * For an inline node written right after other content, with no delimiter
   * or whitespace between: that content, and its marks that end there.
   */
  readonly adjacent?: {
    node: ProseMirrorNode;
    endingMarks: readonly Mark[];
  } | null;
  /** The markdown of a textblock's content, with `data` for its writers. */
  inline(node: ProseMirrorNode, data?: Record<string, unknown>): string;
  /**
   * The markdown of a container's children, reusing the source of those that
   * did not change. Prefixes for the container's lines are added by the
   * caller.
   */
  children(node: ProseMirrorNode, options?: ChildrenOptions): string;
  /** Escapes text that has to be read back as text, as `safe` does. */
  escape(text: string): string;
  /** The link reference definition of `label` in the document, if any. */
  definition(label: string): { url: string; title: string | null } | undefined;
}

export interface ChildrenOptions {
  /** What separates two children whose source cannot be reused. */
  separator?: (previous: ProseMirrorNode, next: ProseMirrorNode) => string;
  /** Data passed to each child's writer. */
  data?: (index: number) => Record<string, unknown>;
  /** Whether an unchanged child's source still fits where it now is. */
  reusable?: (source: string, index: number) => boolean;
  /** Children the writer leaves out, such as empty paragraphs. */
  skip?: (child: ProseMirrorNode, index: number) => boolean;
}

/**
 * `next` writes the node as the definition registered before this one would,
 * so a definition can decorate another's output instead of replacing it.
 */
export type NodeToMarkdown = (
  node: ProseMirrorNode,
  context: WriteContext,
  next: () => string,
) => string;

export interface NodeWriter {
  write: NodeToMarkdown;
  /**
   * The attributes as markdown holds them, when the writer normalises them:
   * a document and the one read back from its markdown are compared by these.
   */
  writtenAttrs?: (
    attrs: Record<string, unknown>,
    node: ProseMirrorNode,
  ) => Record<string, unknown>;
  /**
   * The writer only adds to the one registered before it, so without one
   * the definition writes no such node.
   */
  decorates?: boolean;
  /**
   * The node markdown reads the node's markdown as, when it is another one,
   * as an empty heading is read as the end of a section.
   */
  writtenAs?: (
    node: ProseMirrorNode,
  ) => { type: string; attrs: Record<string, unknown> } | null;
  /**
   * The marker of a list written as `source`. Two adjacent lists of one type
   * with the same marker would be read as a single list.
   */
  listMarker?: (source: string) => string | undefined;
}

export interface MarkToMarkdown {
  open: string | ((mark: Mark, context: WriteContext) => string);
  /** `text` is the text under the mark, as it is in the document. */
  close: string | ((mark: Mark, context: WriteContext, text: string) => string);
  /** Delimiters that cannot have whitespace just inside them, like `*`. */
  flanking?: boolean;
  /**
   * The HTML element the mark is written as where its delimiters could not
   * open or close it, as next to `「` in Japanese. The definition has to read
   * the element as the mark too.
   */
  html?: string;
  /** The attributes the HTML element is written with. */
  htmlAttributes?: (mark: Mark) => Record<string, string>;
  /** The text under the mark is written as is. */
  verbatim?: boolean;
  /** Writes a whole run of text under the mark, delimiters included. */
  run?: (text: string, mark: Mark) => string;
  /**
   * Whether the text can be written without the mark because markdown reads
   * the mark into it anyway, as with a bare URL.
   */
  implied?: (run: InlineRun, context: WriteContext) => boolean;
}

/**
 * Changes how the definition registered before this one writes a mark, e.g.
 * to add something after its closing delimiter.
 */
export type MarkDecorator = (previous: MarkToMarkdown) => MarkToMarkdown;

export interface InlineRun {
  node: ProseMirrorNode;
  previous: ProseMirrorNode | undefined;
  next: ProseMirrorNode | undefined;
  afterNext: ProseMirrorNode | undefined;
}

/**
 * A choice between ways of writing the same thing, such as `*` or `_` for
 * emphasis. Generated markdown follows the choice the source makes most often.
 */
export interface StyleSpec {
  default: string;
  /** Reads the choice a node of the source made, by mdast type. */
  detect?: Record<string, (node: UnknownMdastNode, source: string) => unknown>;
}

/**
 * Characters that `safe` escaping has to escape in text. Each match of
 * `pattern` (which must be global) is one character, unless the rule
 * encloses. A text starts after a
 * `\n` when it starts a line, and ends before one when it ends a block, so
 * patterns can look around for `\n`.
 */
export interface EscapeRule {
  pattern: RegExp;
  /** Writes a character reference, for characters a backslash cannot escape. */
  entity?: boolean;
  /**
   * Writes the whole match in a form that reads back as it, instead of
   * escaping its first character, or null where there is none for text
   * under `marks`. The match is then not escaped within: an enclosure is for
   * text that markdown reads into syntax whatever is escaped in it.
   */
  enclose?: (match: string, marks: readonly Mark[]) => string | null;
}

/**
 * An HTML element read as a mark when its tags are around phrasing, or as a
 * node when its tags are HTML blocks around other blocks (with blank lines
 * between).
 */
export interface HtmlElementSpec {
  kind: 'mark' | 'block';
  /** The mark or node type. */
  type: string;
  tag: string;
  /** Attributes the opening tag must have, with these values. */
  match?: Record<string, string>;
  /** Attributes the opening tag may have, kept as the type's attributes. */
  capture?: string[];
  /**
   * The attribute of the type that keeps the tag's other attributes, by
   * name. Without it, a tag with other attributes is not the element.
   */
  rest?: string;
}

/**
 * Whether a textblock holds nothing markdown can: line breaks alone, which
 * cannot start or end one, leave it empty.
 */
export function isEmptyTextblock(node: ProseMirrorNode): boolean {
  if (!node.isTextblock) {
    return false;
  }
  let empty = true;
  node.forEach((child) => {
    empty &&= child.isText
      ? /^\n*$/.test(child.text ?? '')
      : child.type.spec.linebreakReplacement === true;
  });
  return empty;
}

/** The attributes of an opening tag, from the text after its name. */
export function readTagAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(
    /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** The opening tag of an element with fixed and captured attributes. */
export function openingTag(
  spec: Pick<HtmlElementSpec, 'tag' | 'match' | 'capture'>,
  attrs: Readonly<Record<string, unknown>>,
  others: Readonly<Record<string, string>> = {},
): string {
  const parts = [
    ...Object.entries(spec.match ?? {}),
    ...(spec.capture ?? []).flatMap((name) =>
      typeof attrs[name] === 'string' ? [[name, attrs[name] as string]] : [],
    ),
    ...Object.entries(others),
  ].map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`);
  return `<${spec.tag}${parts.join('')}>`;
}

/**
 * Everything the editor knows about one piece of markdown syntax: the schema
 * it needs, how its mdast becomes ProseMirror content and back, and what has
 * to be escaped so text is not read as it.
 */
export interface NotationDefinition {
  name: string;
  /**
   * Bumped when the definition reads or writes something differently, so
   * documents record which definitions made them.
   */
  version?: number;
  /**
   * The definition as it was at earlier versions, for documents made with
   * them. They are only used to read and write such documents, so they
   * bring no extensions of their own.
   */
  earlier?: readonly NotationDefinition[];
  extensions?: Extensions;
  /** remark plugins, e.g. ones adding micromark and mdast extensions. */
  remarkPlugins?: Pluggable[];
  fromMarkdown?: FromMarkdownHandlers;
  htmlElements?: HtmlElementSpec[];
  nodes?: Record<string, NodeToMarkdown | NodeWriter>;
  marks?: Record<string, MarkToMarkdown | MarkDecorator>;
  styles?: Record<string, StyleSpec>;
  escapes?: EscapeRule[];
  /**
   * The attributes this definition writes on the nodes and marks of others,
   * which a document whose definitions lack it cannot keep: by name, or as
   * `type:name` where other definitions write the name on other types.
   */
  attributes?: readonly string[];
}

export function defineNotation(
  definition: NotationDefinition,
): NotationDefinition {
  return definition;
}

/** A mark written between two copies of a delimiter, like `~~`. */
export interface DelimitedMarkDeclaration {
  kind: 'delimitedMark';
  name: string;
  mark: string;
  /** The mdast node type the parser makes of the syntax. */
  mdastType: string;
  delimiter: string;
  /** The HTML element read as the mark too, see `MarkToMarkdown.html`. */
  tag?: string;
}

/** A mark written as an inline HTML element, like `<span class="tcy">`. */
export interface HtmlMarkDeclaration {
  kind: 'htmlMark';
  name: string;
  mark: string;
  tag: string;
  match?: Record<string, string>;
  capture?: string[];
}

/**
 * A block written as an HTML element around markdown, like
 * `<aside class="sidenote">`, a blank line, the content, a blank line and
 * `</aside>`.
 */
export interface HtmlBlockDeclaration {
  kind: 'htmlBlock';
  name: string;
  node: string;
  tag: string;
  match?: Record<string, string>;
  capture?: string[];
}

export type NotationDeclaration =
  | DelimitedMarkDeclaration
  | HtmlMarkDeclaration
  | HtmlBlockDeclaration;

function selectorOf(spec: Pick<HtmlElementSpec, 'tag' | 'match'>): string {
  return `${spec.tag}${Object.entries(spec.match ?? {})
    .map(([name, value]) => `[${name}="${value.replace(/["\\]/g, '\\$&')}"]`)
    .join('')}`;
}

function attributesOf(capture: readonly string[] = []) {
  return Object.fromEntries(
    capture.map((name) => [
      name,
      {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(name),
      },
    ]),
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a definition from a plain description, for syntax that needs no
 * code of its own. Without `extensions`, a mark of the declared name is
 * created for the schema.
 */
export function declareNotation(
  declaration: NotationDeclaration,
  extensions?: Extensions,
): NotationDefinition {
  switch (declaration.kind) {
    case 'delimitedMark': {
      const { name, mark, mdastType, delimiter, tag } = declaration;
      return {
        name,
        extensions: extensions ?? [
          MarkExtension.create({
            name: mark,
            parseHTML: () => [{ tag: `span[data-mark="${mark}"]` }],
            renderHTML: () => ['span', { 'data-mark': mark }, 0],
          }),
        ],
        fromMarkdown: {
          [mdastType]: (node: UnknownMdastNode, context: ParseContext) => {
            const type = context.schema.marks[mark];
            return type
              ? context.inlines(node, type.create().addToSet(context.marks))
              : undefined;
          },
        },
        ...(tag && {
          htmlElements: [{ kind: 'mark' as const, type: mark, tag }],
        }),
        marks: {
          [mark]: {
            open: delimiter,
            close: delimiter,
            flanking: true,
            ...(tag && { html: tag }),
          },
        },
        escapes: [
          { pattern: new RegExp(escapeRegExp(delimiter.charAt(0)), 'g') },
        ],
      };
    }
    case 'htmlMark': {
      const { name, mark, tag, match, capture } = declaration;
      const spec = { tag, match, capture };
      return {
        name,
        extensions: extensions ?? [
          MarkExtension.create({
            name: mark,
            addAttributes: () => attributesOf(capture),
            parseHTML: () => [{ tag: selectorOf(spec) }],
            renderHTML: ({ HTMLAttributes }) => [
              tag,
              { ...match, ...HTMLAttributes },
              0,
            ],
          }),
        ],
        htmlElements: [{ kind: 'mark', type: mark, ...spec }],
        marks: {
          [mark]: {
            open: (it) => openingTag(spec, it.attrs),
            close: `</${tag}>`,
          },
        },
      };
    }
    case 'htmlBlock': {
      const { name, node, tag, match, capture } = declaration;
      const spec = { tag, match, capture };
      return {
        name,
        extensions: extensions ?? [
          NodeExtension.create({
            name: node,
            group: 'block',
            content: 'block+',
            defining: true,
            addAttributes: () => attributesOf(capture),
            parseHTML: () => [{ tag: selectorOf(spec) }],
            renderHTML: ({ HTMLAttributes }) => [
              tag,
              { ...match, ...HTMLAttributes },
              0,
            ],
          }),
        ],
        htmlElements: [{ kind: 'block', type: node, ...spec }],
        nodes: {
          [node]: (it, context) =>
            `${openingTag(spec, it.attrs)}\n\n${context.children(it)}\n\n</${tag}>`,
        },
      };
    }
  }
}
