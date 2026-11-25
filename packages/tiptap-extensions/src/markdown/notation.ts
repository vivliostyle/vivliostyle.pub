import type { Extensions } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { decodeString } from 'micromark-util-decode-string';
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
  writtenAttrs?: (attrs: Record<string, unknown>) => Record<string, unknown>;
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
 * An HTML element read as one of the definition's marks or nodes, by `kind`:
 *
 * - `mark`: tags around phrasing, as a mark on it.
 * - `inline`: tags around phrasing, as an inline node holding it.
 * - `atom`: an opening tag right before its closing tag, as an inline node.
 * - `block`: tags that are HTML blocks of their own around other blocks,
 *   with blank lines between, as a node holding them.
 * - `textblock`: one HTML block of the element holding text alone, as a
 *   textblock. Markdown does not read what is inside an HTML block.
 */
export interface HtmlElementSpec {
  kind: 'mark' | 'inline' | 'atom' | 'block' | 'textblock';
  /** The mark or node type. */
  type: string;
  tag: string;
  /** Classes the element must have. It may have others too. */
  classes?: readonly string[];
  /** Attributes the opening tag must have, with these values. */
  match?: Readonly<Record<string, string>>;
  /** Attributes the opening tag may have, kept as the type's attributes. */
  capture?: readonly string[];
  /** Of the attributes in `capture`, those the opening tag must have. */
  require?: readonly string[];
  /**
   * The attribute of the type that keeps the tag's other attributes, by
   * name, with the classes not in `classes` as `class`. Without it, a tag
   * with other attributes is not the element.
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

/**
 * HTML text with its character references read. A backslash is a character
 * of its own there, so it escapes nothing.
 */
export function decodeHtml(text: string): string {
  return text.includes('&')
    ? text.split('\\').map(decodeString).join('\\')
    : text;
}

/** HTML text that reads back as `text`, where tags could start. */
export function encodeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** The name and attributes of HTML that is one opening tag. */
export function readOpeningTag(
  value: string,
): { name: string; attributes: Record<string, string> } | null {
  const tag = value.trim().match(/^<([A-Za-z][\w-]*)(\s[^>]*)?>$/);
  if (!tag) {
    return null;
  }
  const attributes = readTagAttributes(tag[2] ?? '');
  for (const [name, written] of Object.entries(attributes)) {
    attributes[name] = decodeHtml(written);
  }
  return { name: tag[1].toLowerCase(), attributes };
}

function classesOf(value: string | undefined): string[] {
  return value?.split(/[ \t\n\f\r]+/).filter(Boolean) ?? [];
}

/**
 * The attributes an element with `attributes` gives the spec's mark or
 * node, or null when it is not the spec's element.
 */
export function matchAttributes(
  attributes: Readonly<Record<string, string>>,
  spec: Pick<
    HtmlElementSpec,
    'classes' | 'match' | 'capture' | 'require' | 'rest'
  >,
): Record<string, unknown> | null {
  for (const [name, expected] of Object.entries(spec.match ?? {})) {
    if (attributes[name] !== expected) {
      return null;
    }
  }
  if ((spec.require ?? []).some((name) => attributes[name] === undefined)) {
    return null;
  }
  const required = spec.classes ?? [];
  const classes = classesOf(attributes.class);
  if (required.some((name) => !classes.includes(name))) {
    return null;
  }
  const known = new Set([
    ...Object.keys(spec.match ?? {}),
    ...(spec.capture ?? []),
  ]);
  const others = Object.entries(attributes).filter(
    ([name]) => !known.has(name) && !(name === 'class' && required.length > 0),
  );
  const otherClasses = classes.filter((name) => !required.includes(name));
  if (required.length > 0 && otherClasses.length > 0 && !known.has('class')) {
    others.unshift(['class', otherClasses.join(' ')]);
  }
  if (others.length > 0 && !spec.rest) {
    return null;
  }
  return {
    ...Object.fromEntries(
      (spec.capture ?? []).map((name) => [name, attributes[name] ?? null]),
    ),
    ...(spec.rest && {
      [spec.rest]: others.length > 0 ? Object.fromEntries(others) : null,
    }),
  };
}

/** The attributes an opening tag gives the spec's mark or node, or null. */
export function matchOpeningTag(
  value: string,
  spec: HtmlElementSpec,
): Record<string, unknown> | null {
  const tag = readOpeningTag(value);
  return tag && tag.name === spec.tag.toLowerCase()
    ? matchAttributes(tag.attributes, spec)
    : null;
}

/**
 * The opening tag of an element with fixed and captured attributes, and
 * `others`, whose `class` is added to the fixed classes.
 */
export function openingTag(
  spec: Pick<HtmlElementSpec, 'tag' | 'classes' | 'match' | 'capture'>,
  attrs: Readonly<Record<string, unknown>>,
  others: Readonly<Record<string, string>> = {},
): string {
  const classes = [...(spec.classes ?? []), ...classesOf(others.class)];
  const parts = [
    ...(classes.length > 0 ? [['class', classes.join(' ')]] : []),
    ...Object.entries(spec.match ?? {}),
    ...(spec.capture ?? []).flatMap((name) =>
      typeof attrs[name] === 'string' ? [[name, attrs[name] as string]] : [],
    ),
    ...Object.entries(others).filter(([name]) => name !== 'class'),
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
  /**
   * What a node of the definition becomes in a document whose definitions
   * lack it, by node type, so its content and markup are not lost: e.g. its
   * tags as raw markdown around its content.
   */
  dissolve?: Record<string, (node: ProseMirrorNode) => ProseMirrorNode[]>;
}

export function defineNotation(
  definition: NotationDefinition,
): NotationDefinition {
  return definition;
}
