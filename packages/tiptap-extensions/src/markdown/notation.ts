import { type Extensions, Mark as MarkExtension } from '@tiptap/core';
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
  /** Keeps the node's source as written, as the raw fallback does. */
  raw(node: UnknownMdastNode): ProseMirrorNode[];
  /** Converts the content of a container whose lines carry `prefix`. */
  within<T>(prefix: LinePrefix, convert: () => T): T;
}

type Handler<Node> = {
  bivarianceHack(node: Node, context: ParseContext): FromMarkdownResult;
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
   * `minimal` writes text as is. The output is read back, and if it does not
   * come back as the same document it is written again `safe`, escaping every
   * character that could mean something.
   */
  readonly escaping: 'minimal' | 'safe';
  /** Data the container passes to the child being written. */
  readonly data: Readonly<Record<string, unknown>>;
  /** List markers the block must not use, or it would merge with a neighbour. */
  readonly avoidMarkers: ReadonlySet<string>;
  /** The node's source before it changed, when it had one. */
  readonly base: BaseNode | null;
  /** The markdown of a textblock's content. */
  inline(node: ProseMirrorNode): string;
  /**
   * The markdown of a container's children, reusing the source of those that
   * did not change. Prefixes for the container's lines are added by the
   * caller.
   */
  children(node: ProseMirrorNode, options?: ChildrenOptions): string;
  /** Escapes text that has to be read back as text, as `safe` does. */
  escape(text: string): string;
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

export type NodeToMarkdown = (
  node: ProseMirrorNode,
  context: WriteContext,
) => string;

export interface NodeWriter {
  write: NodeToMarkdown;
  /**
   * The marker of a list written as `source`. Two adjacent lists of one type
   * with the same marker would be read as a single list.
   */
  listMarker?: (source: string) => string | undefined;
}

export interface MarkToMarkdown {
  open: string | ((mark: Mark, context: WriteContext) => string);
  close: string | ((mark: Mark, context: WriteContext) => string);
  /** Delimiters that cannot have whitespace just inside them, like `*`. */
  flanking?: boolean;
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
 * `pattern` (which must be global) is one character. A text starts after a
 * `\n` when it starts a line, and ends before one when it ends a block, so
 * patterns can look around for `\n`.
 */
export interface EscapeRule {
  pattern: RegExp;
  /** Writes a character reference, for characters a backslash cannot escape. */
  entity?: boolean;
}

/** An inline HTML element whose tags around phrasing are read as a mark. */
export interface HtmlMarkSpec {
  mark: string;
  tag: string;
  /** The attributes as written in the opening tag, e.g. `class="tcy"`. */
  attributes?: string;
}

/**
 * Everything the editor knows about one piece of markdown syntax: the schema
 * it needs, how its mdast becomes ProseMirror content and back, and what has
 * to be escaped so text is not read as it.
 */
export interface NotationDefinition {
  name: string;
  extensions?: Extensions;
  /** remark plugins, e.g. ones adding micromark and mdast extensions. */
  remarkPlugins?: Pluggable[];
  fromMarkdown?: FromMarkdownHandlers;
  htmlMarks?: HtmlMarkSpec[];
  nodes?: Record<string, NodeToMarkdown | NodeWriter>;
  marks?: Record<string, MarkToMarkdown>;
  styles?: Record<string, StyleSpec>;
  escapes?: EscapeRule[];
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
}

/** A mark written as an inline HTML element, like `<u>`. */
export interface HtmlMarkDeclaration {
  kind: 'htmlMark';
  name: string;
  mark: string;
  tag: string;
  attributes?: string;
}

export type NotationDeclaration =
  | DelimitedMarkDeclaration
  | HtmlMarkDeclaration;

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
      const { name, mark, mdastType, delimiter } = declaration;
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
        marks: {
          [mark]: { open: delimiter, close: delimiter, flanking: true },
        },
        escapes: [
          { pattern: new RegExp(escapeRegExp(delimiter.charAt(0)), 'g') },
        ],
      };
    }
    case 'htmlMark': {
      const { name, mark, tag, attributes } = declaration;
      const openTag = attributes ? `<${tag} ${attributes}>` : `<${tag}>`;
      return {
        name,
        extensions: extensions ?? [
          MarkExtension.create({
            name: mark,
            parseHTML: () => [{ tag }],
            renderHTML: () => [tag, 0],
          }),
        ],
        htmlMarks: [{ mark, tag, ...(attributes && { attributes }) }],
        marks: { [mark]: { open: openTag, close: `</${tag}>` } },
      };
    }
  }
}
