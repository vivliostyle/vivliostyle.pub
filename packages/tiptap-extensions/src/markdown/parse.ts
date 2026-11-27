import {
  type ContentMatch,
  Fragment,
  type Mark,
  type NodeType,
  type Node as ProseMirrorNode,
  type Schema,
} from '@tiptap/pm/model';
import { decodeString } from 'micromark-util-decode-string';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import {
  decodeHtml,
  isEndTag,
  readEndTag,
  readStartTag,
  tagBalance,
} from './html';
import { childrenOf, type UnknownMdastNode } from './mdast';
import {
  type EscapeRule,
  type FromMarkdownHandler,
  type FromMarkdownResult,
  type HtmlElementSpec,
  matchOpeningTag,
  type NotationDefinition,
  type ParseContext,
  type StyleSpec,
} from './notation';
import { type LinePrefix, stripPrefixes } from './source';

export const RAW_BLOCK = 'rawBlock';
export const RAW_INLINE = 'rawInline';

const BLOCK_KINDS: readonly HtmlElementSpec['kind'][] = ['block'];
const INLINE_KINDS: readonly HtmlElementSpec['kind'][] = [
  'mark',
  'inline',
  'atom',
];

/** Where a node of a parsed document was written in the source. */
export interface SourceRange {
  start: number;
  end: number;
  /** The prefixes of the containers around the node. */
  prefixes: readonly LinePrefix[];
}

/**
 * A piece of a textblock's content and where it was written: `from` and `to`
 * are offsets in the textblock's content, `start` and `end` in the source.
 */
export interface InlineUnit {
  from: number;
  to: number;
  start: number;
  end: number;
  /**
   * Each character of the piece was written as itself, at the same distance
   * from `start`, so any part of it can be reused on its own.
   */
  splittable: boolean;
}

/**
 * Where the content of a textblock was written. Source between two units,
 * such as the prefixes of a quote's lines, belongs to neither.
 */
export interface InlineSource {
  /** The text the units' `start` and `end` point into. */
  text: string;
  /** The prefixes of the containers around the textblock. */
  prefixes: readonly LinePrefix[];
  units: readonly InlineUnit[];
}

export interface ParsedBody {
  body: string;
  doc: ProseMirrorNode;
  /** Source ranges of the nodes made from exactly one mdast node. */
  ranges: WeakMap<ProseMirrorNode, SourceRange>;
  /** Where the content of the textblocks in `ranges` was written. */
  inlines: WeakMap<ProseMirrorNode, InlineSource>;
  /**
   * The tags of the HTML elements a node was read from: of a block or
   * textblock element itself, or of the elements in a textblock's content,
   * in the order they open.
   */
  elements: WeakMap<ProseMirrorNode, readonly ElementSource[]>;
  styles: ReadonlyMap<string, string>;
}

/** How an HTML element read as a mark or node was written. */
export interface ElementSource {
  /** The mark or node type. */
  type: string;
  /** The attributes it was read with, as JSON. */
  attrs: string;
  open: string;
  close: string;
  /** For a textblock, its content as written. */
  inner?: string;
  /** For a block, what is between its tags and its first and last block. */
  lead?: string;
  trail?: string;
}

/**
 * How specific a spec is: an element both of two specs match is the one of
 * the spec with more conditions.
 */
function specificity(spec: HtmlElementSpec): number {
  return (
    (spec.classes?.length ?? 0) +
    Object.keys(spec.match ?? {}).length +
    (spec.require?.length ?? 0)
  );
}

/**
 * Of the candidates, the one of the most specific spec, or null where specs
 * of different types are as specific.
 */
function mostSpecific<T extends { spec: HtmlElementSpec }>(
  candidates: readonly T[],
): T | null {
  let best: T[] = [];
  for (const candidate of candidates) {
    const level = specificity(candidate.spec);
    const top = best[0] ? specificity(best[0].spec) : -1;
    if (level > top) {
      best = [candidate];
    } else if (level === top) {
      best.push(candidate);
    }
  }
  const [first] = best;
  return first && best.every((it) => it.spec.type === first.spec.type)
    ? first
    : null;
}

/** Whether a node of `parent` can hold one of `type` somewhere. */
function canHold(parent: NodeType, type: NodeType): boolean {
  const seen = new Set<ContentMatch>();
  const queue = [parent.contentMatch];
  while (queue.length > 0) {
    const match = queue.pop() as ContentMatch;
    if (seen.has(match)) {
      continue;
    }
    seen.add(match);
    for (let i = 0; i < match.edgeCount; i++) {
      const edge = match.edge(i);
      if (edge.type === type) {
        return true;
      }
      queue.push(edge.next);
    }
  }
  return false;
}

function rangeOf(node: UnknownMdastNode): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`The ${node.type} node has no position`);
  }
  return { start, end };
}

const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

/**
 * The punctuation some definition gives meaning, i.e. that one of the
 * escape rules escapes somewhere.
 */
function meaningfulPunctuation(rules: readonly EscapeRule[]): Set<string> {
  const meaningful = new Set<string>();
  for (const char of ASCII_PUNCTUATION) {
    const probes = [
      `\n${char}\n`,
      `a${char}a`,
      ` ${char} `,
      `\n1${char} `,
      `${char}[`,
      `www${char}`,
      `http${char}//`,
      `a${char}\n`,
    ];
    const found = probes.some((probe) =>
      rules.some(
        (rule) =>
          !rule.enclose &&
          [...probe.matchAll(rule.pattern)].some(
            (match) => probe[match.index] === char,
          ),
      ),
    );
    if (found) {
      meaningful.add(char);
    }
  }
  return meaningful;
}

/**
 * Moves nodes that micromark lets overlap the previous sibling, such as a
 * setext heading right after a link reference definition, to the line after
 * it.
 */
function separateSiblings(node: UnknownMdastNode, body: string): void {
  let previousEnd = -1;
  for (const child of childrenOf(node)) {
    const position = child.position;
    if (position && position.start.offset !== undefined) {
      if (previousEnd > position.start.offset) {
        let start = previousEnd;
        if (body[start] === '\n') {
          start++;
        }
        position.start = {
          line: position.start.line,
          column: start - body.lastIndexOf('\n', start - 1),
          offset: start,
        };
      }
      previousEnd = position.end.offset ?? previousEnd;
    }
    separateSiblings(child, body);
  }
}

function textOf(node: UnknownMdastNode): string {
  return node.value ?? childrenOf(node).map(textOf).join('');
}

/**
 * Gives phrasing that a transform made after reading, such as the text and
 * links of GFM autolinks, the position of its text in the source, which it
 * is written as there.
 */
function placeTransformed(node: UnknownMdastNode, body: string): void {
  const children = childrenOf(node);
  let cursor = node.position?.start.offset;
  children.forEach((child, index) => {
    if (cursor !== undefined && !child.position) {
      const next = children.slice(index + 1).find((it) => it.position)?.position
        ?.start.offset;
      const text = textOf(child);
      const at = cursor;
      if (
        text &&
        body.startsWith(text, at) &&
        (next === undefined || at + text.length <= next)
      ) {
        child.position = {
          start: { line: 0, column: 0, offset: at },
          end: { line: 0, column: 0, offset: at + text.length },
        };
      }
    }
    cursor = child.position?.end.offset ?? undefined;
    placeTransformed(child, body);
  });
}

/**
 * Where raw blocks among the children of `container` are the tags of a
 * declared block element around the blocks between them, which reading
 * their markdown makes that element of: by the indices of the two tags, and
 * the element.
 */
export function rawBlockElements(
  container: ProseMirrorNode,
  specs: readonly HtmlElementSpec[],
): { from: number; to: number; node: ProseMirrorNode }[] {
  const children: ProseMirrorNode[] = [];
  container.forEach((child) => {
    children.push(child);
  });
  const rawText = (index: number) =>
    children[index]?.type.name === RAW_BLOCK
      ? children[index].textContent
      : null;
  const { schema } = container.type;
  const found: { from: number; to: number; node: ProseMirrorNode }[] = [];
  for (let from = 0; from < children.length; from++) {
    const text = rawText(from);
    if (text === null) {
      continue;
    }
    const candidates = specs.flatMap((spec) => {
      const type = schema.nodes[spec.type];
      const attrs =
        spec.kind === 'block' && type ? matchOpeningTag(text, spec) : null;
      if (!attrs || !type) {
        return [];
      }
      const name = spec.tag.toLowerCase();
      let depth = 0;
      for (let to = from + 1; to < children.length; to++) {
        const between = rawText(to);
        if (between === null) {
          continue;
        }
        if (depth === 0 && isEndTag(between, name)) {
          return [{ spec, attrs, type, to }];
        }
        const balance = tagBalance(between, name);
        if (!balance || depth + balance.low < 0) {
          return [];
        }
        depth += balance.depth;
      }
      return [];
    });
    const best = mostSpecific(candidates);
    if (!best) {
      continue;
    }
    const node = best.type.createAndFill(
      best.attrs,
      children.slice(from + 1, best.to),
    );
    if (
      node &&
      (best.type.isInGroup('block') || canHold(container.type, best.type)) &&
      container.canReplace(from, best.to + 1, Fragment.from(node))
    ) {
      found.push({ from, to: best.to, node });
      from = best.to;
    }
  }
  return found;
}

class Converter {
  private prefixes: LinePrefix[] = [];
  private marks: readonly Mark[] = [];
  readonly ranges = new WeakMap<ProseMirrorNode, SourceRange>();
  readonly inlineSources = new WeakMap<ProseMirrorNode, InlineSource>();
  readonly elements = new WeakMap<ProseMirrorNode, readonly ElementSource[]>();
  private readonly context: ParseContext;
  /** The elements of the textblock's content being converted. */
  private inlineElements: ElementSource[] | null = null;
  private lastElements: {
    parent: UnknownMdastNode | undefined;
    list: ElementSource[];
  } | null = null;
  /**
   * The declared element whose blocks are being converted, the document at
   * the top level, or null in a container of other syntax.
   */
  private blockParent: NodeType | null = null;
  /** How deep the phrasing being converted is; 1 is a textblock's own. */
  private inlineDepth = 0;
  /** Units `literal` found in the text node being converted at depth 1. */
  private textUnits: InlineUnit[] | null = null;
  private lastInlines: {
    parent: UnknownMdastNode | undefined;
    units: InlineUnit[];
    size: number;
  } | null = null;

  constructor(
    private readonly schema: Schema,
    private readonly body: string,
    private readonly handlers: ReadonlyMap<string, FromMarkdownHandler[]>,
    private readonly htmlElements: readonly HtmlElementSpec[],
    private readonly meaningful: ReadonlySet<string>,
  ) {
    const converter = this;
    this.context = {
      schema,
      get marks() {
        return converter.marks;
      },
      source: (node) => this.source(node),
      column: (node) => (node.position?.start.column ?? 1) - 1,
      blocks: (parent) => this.blocks(parent),
      inlines: (parent, marks) =>
        marks
          ? this.withMarks(marks, () =>
              this.inlines(childrenOf(parent), parent),
            )
          : this.inlines(childrenOf(parent), parent),
      text: (value, marks) => this.text(value, marks ?? this.marks),
      literal: (node) => this.literal(node),
      raw: (node) =>
        this.inInline ? this.rawInline(node) : this.rawBlock(node),
      within: (prefix, convert) => {
        this.prefixes.push(prefix);
        try {
          return convert();
        } finally {
          this.prefixes.pop();
        }
      },
    };
  }

  private inInline = false;

  source(node: UnknownMdastNode): string {
    const { start, end } = rangeOf(node);
    return stripPrefixes(this.body.slice(start, end), this.prefixes);
  }

  root(root: UnknownMdastNode): ProseMirrorNode {
    this.blockParent = this.schema.topNodeType;
    const doc = this.schema.topNodeType.createAndFill(
      null,
      this.blocks(root, true),
    );
    if (!doc) {
      throw new Error('The markdown does not fit the schema');
    }
    return doc;
  }

  private withMarks<T>(marks: readonly Mark[], convert: () => T): T {
    const previous = this.marks;
    this.marks = marks;
    try {
      return convert();
    } finally {
      this.marks = previous;
    }
  }

  private handle(node: UnknownMdastNode): readonly ProseMirrorNode[] | null {
    const handlers = this.handlers.get(node.type) ?? [];
    const from = (start: number): FromMarkdownResult => {
      for (let index = start; index < handlers.length; index++) {
        const result = handlers[index](node, this.context, () =>
          from(index + 1),
        );
        if (result !== undefined) {
          return result;
        }
      }
      return undefined;
    };
    const result = from(0);
    if (result === undefined) {
      return null;
    }
    if (result === null) {
      return [];
    }
    return Array.isArray(result) ? result : [result as ProseMirrorNode];
  }

  private blocks(
    parent: UnknownMdastNode,
    topLevel = false,
  ): ProseMirrorNode[] {
    const parentType = this.blockParent;
    if (!topLevel) {
      this.blockParent = null;
    }
    try {
      return this.blockList(childrenOf(parent), topLevel);
    } finally {
      this.blockParent = parentType;
    }
  }

  private blockList(
    children: readonly UnknownMdastNode[],
    topLevel: boolean,
  ): ProseMirrorNode[] {
    const wasInline = this.inInline;
    this.inInline = false;
    try {
      const result: ProseMirrorNode[] = [];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const element = this.htmlElementAt(children, index, BLOCK_KINDS);
        const textblock = element ? null : this.htmlTextblock(child);
        let nodes: readonly ProseMirrorNode[];
        let last = child;
        if (element) {
          const type = this.schema.nodes[element.spec.type];
          const parentType = this.blockParent;
          this.blockParent = type ?? null;
          let content: ProseMirrorNode[];
          try {
            content = this.blockList(
              children.slice(index + 1, element.close),
              false,
            );
          } finally {
            this.blockParent = parentType;
          }
          const node =
            type && this.canPlace(type)
              ? type.createAndFill(element.attrs, content)
              : null;
          nodes = node ? [node] : this.block(child);
          if (node && type) {
            last = children[element.close];
            const between = (from: UnknownMdastNode, to: UnknownMdastNode) =>
              stripPrefixes(
                this.body.slice(rangeOf(from).end, rangeOf(to).start),
                this.prefixes,
              );
            const inner = children.slice(index + 1, element.close);
            this.elements.set(node, [
              {
                type: type.name,
                attrs: JSON.stringify(node.attrs),
                open: this.source(child),
                close: this.source(last),
                lead: between(child, inner[0] ?? last),
                trail:
                  inner.length > 0 ? between(inner.at(-1) ?? child, last) : '',
              },
            ]);
            index = element.close;
          }
        } else if (textblock) {
          nodes = [textblock];
        } else {
          this.lastInlines = null;
          this.lastElements = null;
          nodes = this.block(child);
          const inlines = this.lastInlines as Converter['lastInlines'];
          const elements = this.lastElements as Converter['lastElements'];
          if (
            nodes.length === 1 &&
            nodes[0].isTextblock &&
            elements?.parent === child &&
            elements.list.length > 0
          ) {
            this.elements.set(nodes[0], elements.list);
          }
          if (
            nodes.length === 1 &&
            nodes[0].isTextblock &&
            inlines?.parent === child &&
            inlines.size === nodes[0].content.size
          ) {
            this.inlineSources.set(nodes[0], {
              text: this.body,
              prefixes: [...this.prefixes],
              units: inlines.units,
            });
          }
        }
        if (nodes.length === 1) {
          let { start } = rangeOf(child);
          const { end } = rangeOf(last);
          // Indentation before a top-level block belongs to it, so reusing
          // its source keeps an indented fence as written.
          if (topLevel) {
            const lineStart = this.body.lastIndexOf('\n', start - 1) + 1;
            if (/^[ \t]*$/.test(this.body.slice(lineStart, start))) {
              start = lineStart;
            }
          }
          this.ranges.set(nodes[0], {
            start,
            end,
            prefixes: [...this.prefixes],
          });
        }
        result.push(...nodes);
      }
      return result;
    } finally {
      this.inInline = wasInline;
    }
  }

  private block(node: UnknownMdastNode): readonly ProseMirrorNode[] {
    const nodes = this.handle(node);
    if (
      nodes === null ||
      nodes.some(
        (result) =>
          !result.isBlock || !result.type.validContent(result.content),
      )
    ) {
      return this.rawBlock(node);
    }
    return nodes;
  }

  private inlines(
    children: readonly UnknownMdastNode[],
    parent?: UnknownMdastNode,
  ): ProseMirrorNode[] {
    const wasInline = this.inInline;
    const depth = this.inlineDepth;
    this.inInline = true;
    this.inlineDepth = wasInline ? depth + 1 : 1;
    const own = this.inlineDepth === 1;
    let units: InlineUnit[] | null = [];
    let size = 0;
    const outerElements = this.inlineElements;
    if (own) {
      this.inlineElements = [];
    }
    try {
      const nodes: ProseMirrorNode[] = [];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const first = index;
        const element = this.htmlElementAt(children, index, INLINE_KINDS);
        const made = element && this.inlineElement(children, index, element);
        let converted: readonly ProseMirrorNode[];
        this.textUnits = null;
        if (element && made) {
          converted = made;
          index = element.close;
        } else {
          converted = this.inline(child);
        }
        nodes.push(...converted);
        if (own && units) {
          const length = converted.reduce((sum, it) => sum + it.nodeSize, 0);
          const found = this.textUnits as InlineUnit[] | null;
          const start = children[first].position?.start.offset;
          const end = children[index].position?.end.offset;
          if (found && found.at(-1)?.to === length) {
            units.push(
              ...found.map((unit) => ({
                ...unit,
                from: unit.from + size,
                to: unit.to + size,
              })),
            );
          } else if (start === undefined || end === undefined) {
            // Made by a transform rather than read, such as a GFM autolink.
            units = null;
          } else if (length > 0) {
            units.push({
              from: size,
              to: size + length,
              start,
              end,
              splittable: false,
            });
          }
          size += length;
        }
      }
      if (own && units) {
        this.lastInlines = { parent, units, size };
      }
      if (own && this.inlineElements) {
        this.lastElements = { parent, list: this.inlineElements };
      }
      return nodes;
    } finally {
      this.inInline = wasInline;
      this.inlineDepth = depth;
      this.textUnits = null;
      if (own) {
        this.inlineElements = outerElements;
      }
    }
  }

  /** Whether a declared block can be where the blocks being read are. */
  private canPlace(type: NodeType): boolean {
    return (
      type.isInGroup('block') ||
      (this.blockParent !== null && canHold(this.blockParent, type))
    );
  }

  /**
   * The element of a spec of one of `kinds` that the HTML node at `index`
   * opens, and the index of the node that closes it. Of specs that match, the
   * most specific is taken, and none where it is not clear which.
   */
  private htmlElementAt(
    children: readonly UnknownMdastNode[],
    index: number,
    kinds: readonly HtmlElementSpec['kind'][],
  ):
    | { spec: HtmlElementSpec; attrs: Record<string, unknown>; close: number }
    | undefined {
    const child = children[index];
    if (child.type !== 'html' || child.value === undefined) {
      return undefined;
    }
    const value = child.value;
    const candidates: {
      spec: HtmlElementSpec;
      attrs: Record<string, unknown>;
      close: number;
    }[] = [];
    for (const spec of this.htmlElements) {
      if (!kinds.includes(spec.kind)) {
        continue;
      }
      const attrs = matchOpeningTag(value, spec);
      if (!attrs) {
        continue;
      }
      const close = this.closingIndex(children, index, spec);
      if (close !== -1) {
        candidates.push({ spec, attrs, close });
      }
    }
    return mostSpecific(candidates) ?? undefined;
  }

  /**
   * The index of the HTML node that is the end tag of the element opened at
   * `index`, counting the tags of the same name in the HTML between, or -1
   * where they cannot be paired.
   */
  private closingIndex(
    children: readonly UnknownMdastNode[],
    index: number,
    spec: HtmlElementSpec,
  ): number {
    const name = spec.tag.toLowerCase();
    if (spec.kind === 'atom') {
      const next = children[index + 1];
      return next?.type === 'html' && isEndTag(next.value, name)
        ? index + 1
        : -1;
    }
    let depth = 0;
    for (let close = index + 1; close < children.length; close++) {
      const candidate = children[close];
      if (candidate.type !== 'html' || candidate.value === undefined) {
        continue;
      }
      if (depth === 0 && isEndTag(candidate.value, name)) {
        return close;
      }
      const balance = tagBalance(candidate.value, name);
      if (!balance || depth + balance.low < 0) {
        return -1;
      }
      depth += balance.depth;
    }
    return -1;
  }

  /** The content a mark or an inline node of an element makes, or null. */
  private inlineElement(
    children: readonly UnknownMdastNode[],
    index: number,
    element: {
      spec: HtmlElementSpec;
      attrs: Record<string, unknown>;
      close: number;
    },
  ): readonly ProseMirrorNode[] | null {
    const { spec, attrs, close } = element;
    const inner = () => children.slice(index + 1, close);
    const source: ElementSource = {
      type: spec.type,
      attrs: '',
      open: this.source(children[index]),
      close: this.source(children[close]),
    };
    const record = (made: Record<string, unknown>) => {
      source.attrs = JSON.stringify(made);
    };
    const list = this.inlineElements;
    const at = list?.length ?? 0;
    list?.push(source);
    const drop = () => {
      list?.splice(at, list.length - at);
      return null;
    };
    const inLink = this.marks.some((mark) => mark.type.name === 'link');
    if (spec.kind === 'mark') {
      const type = this.schema.marks[spec.type];
      // One inside another of its type would merge with it, so it is kept
      // as written.
      if (!type || this.marks.some((mark) => mark.type === type)) {
        return drop();
      }
      const mark = type.create(attrs);
      record(mark.attrs);
      return this.withMarks(mark.addToSet(this.marks), () =>
        this.inlines(inner()),
      );
    }
    const type = this.schema.nodes[spec.type];
    // VFM's HTML has no link inside a link, which a browser splits.
    if (!type || (spec.kind === 'atom' && inLink)) {
      return drop();
    }
    const content =
      spec.kind === 'atom'
        ? []
        : this.withMarks([], () => this.inlines(inner()));
    const holdsLink = content.some((it) =>
      it.marks.some((mark) => mark.type.name === 'link'),
    );
    if (!type.validContent(Fragment.from(content)) || (inLink && holdsLink)) {
      return drop();
    }
    const node = type.create(attrs, content, this.marks);
    record(node.attrs);
    return [node];
  }

  /**
   * The textblock of an element that is one HTML block holding text alone,
   * which markdown does not read, or null.
   */
  private htmlTextblock(node: UnknownMdastNode): ProseMirrorNode | null {
    if (node.type !== 'html' || node.value === undefined) {
      return null;
    }
    const source = this.source(node);
    const value = source.trim();
    const offset = source.indexOf(value);
    const tag = readStartTag(value, 0);
    if (!tag) {
      return null;
    }
    const closeAt = value.lastIndexOf('</');
    const end = closeAt === -1 ? null : readEndTag(value, closeAt);
    if (!end || end.end !== value.length || end.name !== tag.name) {
      return null;
    }
    const inner = value.slice(tag.end, closeAt);
    const text = inner.includes('<') ? null : decodeHtml(inner);
    if (text === null) {
      return null;
    }
    const candidates = this.htmlElements.flatMap((spec) => {
      const type = this.schema.nodes[spec.type];
      const attrs =
        spec.kind === 'textblock' && type && this.canPlace(type)
          ? matchOpeningTag(value.slice(0, tag.end), spec)
          : null;
      return attrs && type ? [{ spec, attrs, type }] : [];
    });
    const found = mostSpecific(candidates);
    if (!found) {
      return null;
    }
    const made = found.type.create(
      found.attrs,
      text ? this.schema.text(text) : null,
    );
    this.elements.set(made, [
      {
        type: found.type.name,
        attrs: JSON.stringify(made.attrs),
        open: source.slice(0, offset + tag.end),
        close: source.slice(offset + closeAt),
        inner,
      },
    ]);
    return made;
  }

  private inline(node: UnknownMdastNode): readonly ProseMirrorNode[] {
    const nodes = this.handle(node);
    if (
      nodes === null ||
      nodes.some(
        (result) =>
          !result.isInline || !result.type.validContent(result.content),
      )
    ) {
      return this.rawInline(node);
    }
    return nodes;
  }

  private text(value: string, marks: readonly Mark[]): ProseMirrorNode[] {
    return value ? [this.schema.text(value, marks)] : [];
  }

  private rawBlock(node: UnknownMdastNode): ProseMirrorNode[] {
    const source = this.source(node);
    const type =
      this.schema.nodes[RAW_BLOCK] ?? this.schema.nodes.paragraph ?? null;
    return type ? [type.create(null, this.text(source, []))] : [];
  }

  /**
   * A text node's value, keeping backslash escapes as raw markdown where no
   * definition gives the escaped character meaning: they still mean
   * something to syntax read elsewhere, such as VFM ruby, and markdown has
   * already read them away.
   */
  private literal(node: UnknownMdastNode): ProseMirrorNode[] {
    const value = node.value ?? '';
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const source =
      start === undefined || end === undefined
        ? ''
        : this.body.slice(start, end);
    const raw = this.schema.marks[RAW_INLINE];
    const rawMarks = raw?.create().addToSet(this.marks);
    const nodes: ProseMirrorNode[] = [];
    const units: InlineUnit[] = [];
    let plain = '';
    let size = 0;
    let i = 0;
    let j = 0;
    const flush = () => {
      nodes.push(...this.text(plain, this.marks));
      plain = '';
    };
    const unit = (length: number, written: number, splittable: boolean) => {
      const last = units.at(-1);
      const at = (start ?? 0) + i;
      if (splittable && last?.splittable && last.end === at) {
        last.to += length;
        last.end += written;
      } else {
        units.push({
          from: size,
          to: size + length,
          start: at,
          end: at + written,
          splittable,
        });
      }
      size += length;
    };
    const asIs = () => {
      this.textUnits = null;
      return this.text(value, this.marks);
    };
    while (i < source.length) {
      const char = source[i];
      const next = source[i + 1];
      if (char === '\\' && next && ASCII_PUNCTUATION.includes(next)) {
        if (value[j] !== next) {
          return asIs();
        }
        if (next !== '\\' && rawMarks && !this.meaningful.has(next)) {
          flush();
          nodes.push(...this.text(char + next, rawMarks));
          unit(2, 2, true);
        } else {
          plain += next;
          unit(1, 2, false);
        }
        i += 2;
        j += 1;
        continue;
      }
      const reference = char === '&' && source.slice(i).match(/^&#?\w+;/)?.[0];
      if (reference) {
        const decoded = decodeString(reference);
        if (value.startsWith(decoded, j)) {
          plain += decoded;
          unit(decoded.length, reference.length, false);
          i += reference.length;
          j += decoded.length;
          continue;
        }
      }
      if (char === value[j]) {
        plain += char;
        unit(1, 1, true);
        i++;
        j++;
        continue;
      }
      // Line prefixes and indentation that markdown leaves out of the text.
      if (
        /[ \t>]/.test(char) &&
        (source[i - 1] === undefined || /[\n \t>]/.test(source[i - 1]))
      ) {
        i++;
        continue;
      }
      // Spaces at the end of a line, which markdown leaves out too.
      if (/[ \t]/.test(char) && /^[ \t]*\n/.test(source.slice(i))) {
        i++;
        continue;
      }
      return asIs();
    }
    if (j !== value.length) {
      return asIs();
    }
    flush();
    if (this.inlineDepth === 1) {
      this.textUnits = units;
    }
    return nodes;
  }

  private rawInline(node: UnknownMdastNode): ProseMirrorNode[] {
    const raw = this.schema.marks[RAW_INLINE];
    return this.text(
      this.source(node),
      raw ? raw.create().addToSet(this.marks) : this.marks,
    );
  }
}

function tallyStyles(
  root: UnknownMdastNode,
  body: string,
  specs: ReadonlyMap<string, StyleSpec>,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  const visit = (node: UnknownMdastNode) => {
    for (const [key, spec] of specs) {
      const detect = spec.detect?.[node.type];
      if (!detect || !node.position) {
        continue;
      }
      const value = detect(
        node,
        body.slice(node.position.start.offset, node.position.end.offset),
      );
      if (typeof value !== 'string') {
        continue;
      }
      const tally = counts.get(key) ?? new Map<string, number>();
      tally.set(value, (tally.get(value) ?? 0) + 1);
      counts.set(key, tally);
    }
    childrenOf(node).forEach(visit);
  };
  visit(root);
  const styles = new Map<string, string>();
  for (const [key, tally] of counts) {
    let best: [string, number] | undefined;
    for (const entry of tally) {
      if (!best || entry[1] > best[1]) {
        best = entry;
      }
    }
    if (best) {
      styles.set(key, best[0]);
    }
  }
  return styles;
}

export class MarkdownParser {
  private readonly handlers = new Map<string, FromMarkdownHandler[]>();
  readonly htmlElements: readonly HtmlElementSpec[];
  private readonly meaningful: ReadonlySet<string>;
  private readonly styleSpecs = new Map<string, StyleSpec>();
  private readonly processor;

  constructor(
    readonly schema: Schema,
    notations: readonly NotationDefinition[],
  ) {
    // Later definitions take precedence, so a bundle added on top of the
    // standard syntax can take over a node type and still fall back to it.
    for (const notation of [...notations].reverse()) {
      for (const [type, handler] of Object.entries(
        notation.fromMarkdown ?? {},
      )) {
        if (handler) {
          this.handlers.set(type, [
            ...(this.handlers.get(type) ?? []),
            handler,
          ]);
        }
      }
    }
    this.htmlElements = notations.flatMap(
      (notation) => notation.htmlElements ?? [],
    );
    this.meaningful = meaningfulPunctuation(
      notations.flatMap((notation) => notation.escapes ?? []),
    );
    for (const notation of notations) {
      for (const [key, spec] of Object.entries(notation.styles ?? {})) {
        this.styleSpecs.set(key, spec);
      }
    }
    this.processor = unified()
      .use(remarkParse)
      .use(notations.flatMap((notation) => notation.remarkPlugins ?? []))
      .freeze();
  }

  get styleDefaults(): ReadonlyMap<string, string> {
    return new Map(
      [...this.styleSpecs].map(([key, spec]) => [key, spec.default]),
    );
  }

  /** Parses markdown without frontmatter, with `\n` line endings. */
  parseBody(body: string): ParsedBody {
    // Transforms get the source, for syntax decided by what is written
    // around a node, such as whitespace that micromark leaves out of it.
    const root: UnknownMdastNode = this.processor.runSync(
      this.processor.parse(body),
      body,
    );
    separateSiblings(root, body);
    placeTransformed(root, body);
    const converter = new Converter(
      this.schema,
      body,
      this.handlers,
      this.htmlElements,
      this.meaningful,
    );
    return {
      body,
      doc: converter.root(root),
      ranges: converter.ranges,
      inlines: converter.inlineSources,
      elements: converter.elements,
      styles: tallyStyles(root, body, this.styleSpecs),
    };
  }
}
