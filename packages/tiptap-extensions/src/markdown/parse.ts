import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { decodeString } from 'micromark-util-decode-string';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { childrenOf, type UnknownMdastNode } from './mdast';
import {
  type EscapeRule,
  type FromMarkdownHandler,
  type FromMarkdownResult,
  type HtmlElementSpec,
  type NotationDefinition,
  type ParseContext,
  readTagAttributes,
  type StyleSpec,
} from './notation';
import { type LinePrefix, stripPrefixes } from './source';

export const RAW_BLOCK = 'rawBlock';
export const RAW_INLINE = 'rawInline';

/** Where a node of a parsed document was written in the source. */
export interface SourceRange {
  start: number;
  end: number;
  /** The prefixes of the containers around the node. */
  prefixes: readonly LinePrefix[];
}

export interface ParsedBody {
  body: string;
  doc: ProseMirrorNode;
  /** Source ranges of the nodes made from exactly one mdast node. */
  ranges: WeakMap<ProseMirrorNode, SourceRange>;
  styles: ReadonlyMap<string, string>;
}

function rangeOf(node: UnknownMdastNode): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`The ${node.type} node has no position`);
  }
  return { start, end };
}

/** The attributes an opening tag gives the spec's mark or node, or null. */
function matchOpeningTag(
  value: string,
  spec: HtmlElementSpec,
): Record<string, unknown> | null {
  const tag = value.trim().match(/^<([A-Za-z][\w-]*)(\s[^>]*)?>$/);
  if (!tag || tag[1].toLowerCase() !== spec.tag.toLowerCase()) {
    return null;
  }
  const attributes = readTagAttributes(tag[2] ?? '');
  for (const [name, expected] of Object.entries(spec.match ?? {})) {
    if (attributes[name] !== expected) {
      return null;
    }
  }
  const known = new Set([
    ...Object.keys(spec.match ?? {}),
    ...(spec.capture ?? []),
  ]);
  if (Object.keys(attributes).some((name) => !known.has(name))) {
    return null;
  }
  return Object.fromEntries(
    (spec.capture ?? []).map((name) => [name, attributes[name] ?? null]),
  );
}

function isClosingTag(value: string | undefined, spec: HtmlElementSpec) {
  return value?.trim().toLowerCase() === `</${spec.tag.toLowerCase()}>`;
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
      rules.some((rule) =>
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

class Converter {
  private prefixes: LinePrefix[] = [];
  private marks: readonly Mark[] = [];
  readonly ranges = new WeakMap<ProseMirrorNode, SourceRange>();
  private readonly context: ParseContext;

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
          ? this.withMarks(marks, () => this.inlines(childrenOf(parent)))
          : this.inlines(childrenOf(parent)),
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
    return this.blockList(childrenOf(parent), topLevel);
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
        const element = this.htmlElementAt(children, index, 'block');
        let nodes: readonly ProseMirrorNode[];
        let last = child;
        if (element) {
          const type = this.schema.nodes[element.spec.type];
          const content = this.blockList(
            children.slice(index + 1, element.close),
            false,
          );
          const node = type?.createAndFill(element.attrs, content);
          nodes = node ? [node] : this.block(child);
          if (node) {
            last = children[element.close];
            index = element.close;
          }
        } else {
          nodes = this.block(child);
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

  private inlines(children: readonly UnknownMdastNode[]): ProseMirrorNode[] {
    const wasInline = this.inInline;
    this.inInline = true;
    try {
      const nodes: ProseMirrorNode[] = [];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const element = this.htmlElementAt(children, index, 'mark');
        const type = element && this.schema.marks[element.spec.type];
        if (element && type) {
          nodes.push(
            ...this.withMarks(
              type.create(element.attrs).addToSet(this.marks),
              () => this.inlines(children.slice(index + 1, element.close)),
            ),
          );
          index = element.close;
          continue;
        }
        nodes.push(...this.inline(child));
      }
      return nodes;
    } finally {
      this.inInline = wasInline;
    }
  }

  private htmlElementAt(
    children: readonly UnknownMdastNode[],
    index: number,
    kind: HtmlElementSpec['kind'],
  ):
    | { spec: HtmlElementSpec; attrs: Record<string, unknown>; close: number }
    | undefined {
    const child = children[index];
    if (child.type !== 'html' || child.value === undefined) {
      return undefined;
    }
    const value = child.value;
    for (const spec of this.htmlElements) {
      if (spec.kind !== kind) {
        continue;
      }
      const attrs = matchOpeningTag(value, spec);
      if (!attrs) {
        continue;
      }
      let depth = 0;
      for (let close = index + 1; close < children.length; close++) {
        const candidate = children[close];
        if (candidate.type !== 'html') {
          continue;
        }
        if (isClosingTag(candidate.value, spec)) {
          if (depth === 0) {
            return { spec, attrs, close };
          }
          depth--;
        } else if (
          candidate.value &&
          matchOpeningTag(candidate.value, { ...spec, match: {}, capture: [] })
        ) {
          depth++;
        }
      }
    }
    return undefined;
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
   * something to syntax read elsewhere, such as VFM ruby or math, and
   * markdown has already read them away. An escaped backslash is kept too,
   * since math reads it as written.
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
    if (!raw || !source.includes('\\')) {
      return this.text(value, this.marks);
    }
    const rawMarks = raw.create().addToSet(this.marks);
    const nodes: ProseMirrorNode[] = [];
    let plain = '';
    let i = 0;
    let j = 0;
    const flush = () => {
      nodes.push(...this.text(plain, this.marks));
      plain = '';
    };
    while (i < source.length) {
      const char = source[i];
      const next = source[i + 1];
      if (char === '\\' && next && ASCII_PUNCTUATION.includes(next)) {
        if (value[j] !== next) {
          return this.text(value, this.marks);
        }
        if (next === '\\' || !this.meaningful.has(next)) {
          flush();
          nodes.push(...this.text(char + next, rawMarks));
        } else {
          plain += next;
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
          i += reference.length;
          j += decoded.length;
          continue;
        }
      }
      if (char === value[j]) {
        plain += char;
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
      return this.text(value, this.marks);
    }
    if (j !== value.length) {
      return this.text(value, this.marks);
    }
    flush();
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
  private readonly htmlElements: HtmlElementSpec[];
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
    const root: UnknownMdastNode = this.processor.runSync(
      this.processor.parse(body),
    );
    separateSiblings(root, body);
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
      styles: tallyStyles(root, body, this.styleSpecs),
    };
  }
}
