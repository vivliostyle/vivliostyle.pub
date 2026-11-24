import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { childrenOf, type UnknownMdastNode } from './mdast';
import type {
  FromMarkdownHandler,
  HtmlMarkSpec,
  NotationDefinition,
  ParseContext,
  StyleSpec,
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

function isOpeningTag(value: string, spec: HtmlMarkSpec): boolean {
  return (
    value ===
    (spec.attributes ? `<${spec.tag} ${spec.attributes}>` : `<${spec.tag}>`)
  );
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
    private readonly htmlMarks: readonly HtmlMarkSpec[],
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
    for (const handler of this.handlers.get(node.type) ?? []) {
      const result = handler(node, this.context);
      if (result === undefined) {
        continue;
      }
      if (result === null) {
        return [];
      }
      return Array.isArray(result) ? result : [result as ProseMirrorNode];
    }
    return null;
  }

  private blocks(
    parent: UnknownMdastNode,
    topLevel = false,
  ): ProseMirrorNode[] {
    const wasInline = this.inInline;
    this.inInline = false;
    try {
      return childrenOf(parent).flatMap((child) => {
        const nodes = this.block(child);
        if (nodes.length === 1) {
          let { start, end } = rangeOf(child);
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
        return nodes;
      });
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
        const htmlMark = this.htmlMarkAt(children, index);
        if (htmlMark) {
          const { spec, close } = htmlMark;
          const type = this.schema.marks[spec.mark];
          nodes.push(
            ...this.withMarks(type.create().addToSet(this.marks), () =>
              this.inlines(children.slice(index + 1, close)),
            ),
          );
          index = close;
          continue;
        }
        nodes.push(...this.inline(child));
      }
      return nodes;
    } finally {
      this.inInline = wasInline;
    }
  }

  private htmlMarkAt(
    children: readonly UnknownMdastNode[],
    index: number,
  ): { spec: HtmlMarkSpec; close: number } | undefined {
    const child = children[index];
    if (child.type !== 'html' || child.value === undefined) {
      return undefined;
    }
    const value = child.value;
    const spec = this.htmlMarks.find(
      (it) => this.schema.marks[it.mark] && isOpeningTag(value, it),
    );
    if (!spec) {
      return undefined;
    }
    let depth = 0;
    for (let close = index + 1; close < children.length; close++) {
      const candidate = children[close];
      if (candidate.type !== 'html') {
        continue;
      }
      if (candidate.value === `</${spec.tag}>`) {
        if (depth === 0) {
          return { spec, close };
        }
        depth--;
      } else if (candidate.value && isOpeningTag(candidate.value, spec)) {
        depth++;
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
  private readonly htmlMarks: HtmlMarkSpec[];
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
    this.htmlMarks = notations.flatMap((notation) => notation.htmlMarks ?? []);
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
    const converter = new Converter(
      this.schema,
      body,
      this.handlers,
      this.htmlMarks,
    );
    return {
      body,
      doc: converter.root(root),
      ranges: converter.ranges,
      styles: tallyStyles(root, body, this.styleSpecs),
    };
  }
}
