import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import type { BaseContent, BaseDocument, BaseNode } from './base';
import {
  type InlinePiece,
  inlinePieces,
  type SourceSegment,
} from './inline-reuse';
import { keyOf, matchSequences } from './match';
import {
  type ChildrenOptions,
  type EscapeRule,
  type MarkToMarkdown,
  type NodeWriter,
  type NotationDefinition,
  openingTag,
  type WriteContext,
} from './notation';
import {
  type MarkdownParser,
  type ParsedBody,
  RAW_BLOCK,
  RAW_INLINE,
} from './parse';
import { WrittenForm } from './written';

/** Which escape candidates of a block are escaped, by their order in it. */
type EscapeSelection = 'none' | 'all' | ReadonlySet<number>;

interface WriteState {
  styles: ReadonlyMap<string, string>;
  escaping: 'minimal' | 'safe';
  /** Whether the source of unchanged nodes is reused. */
  reuse: boolean;
  /** Whether no frontmatter precedes the body being written. */
  bareStart: boolean;
  /**
   * How cautiously each top-level block is written, by position among the
   * written ones; `all` writes every block anew at level 1. See `writeBody`.
   */
  levels: ReadonlyMap<number, number> | 'all';
  /** Whether every top-level block written anew is read back on its own. */
  checkGenerated: boolean;
  /**
   * Whether text the user did not edit has to stay as written even when the
   * output cannot be shown to read back, for a baseline read another way.
   */
  preserve: boolean;
  /** Whether separators from the baseline are kept next to rewritten blocks. */
  keepSeparators: boolean;
  escapes: EscapeSelection;
  /** 0 rewrites only what changed in a textblock, 1 a little more, 2 all. */
  widen: number;
  /** Whether marks are written as their HTML elements where they have one. */
  tags: boolean;
  /** Counts the escape candidates of the block being written. */
  counter: { candidates: number };
}

interface ChildPlan {
  node: ProseMirrorNode;
  index: number;
  base: BaseNode | null;
  baseIndex: number;
  matched: boolean;
}

function childrenOf(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return children;
}

function codePoint(char: string): string {
  return `&#x${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()};`;
}

// `---` opening the document starts frontmatter when another such line
// follows.
const FENCE_START_RE = /^(?:[ \t]*\n)*---[ \t]*(?:\n|$)/;

const DEFINITION_RE = /^ {0,3}\[(?:[^\]\\]|\\.)+\]:/;
const DEFINITION_LINE_RE =
  /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*(<[^>\n]*>|\S+)(?:[ \t]+("[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/gm;

function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

type Definitions = ReadonlyMap<string, { url: string; title: string | null }>;

function readDefinitions(texts: readonly string[]): Definitions {
  const definitions = new Map<string, { url: string; title: string | null }>();
  for (const text of texts) {
    for (const match of text.matchAll(DEFINITION_LINE_RE)) {
      const key = labelKey(match[1]);
      if (!definitions.has(key)) {
        definitions.set(key, {
          url: match[2].replace(/^<(.*)>$/, '$1'),
          title: match[3]?.slice(1, -1) ?? null,
        });
      }
    }
  }
  return definitions;
}

/** Where each top-level block written ended up in the body. */
export type BodyLayout = readonly { start: number; end: number }[];

export interface WriteBodyOptions {
  bareStart: boolean;
  /**
   * Reads a body back and returns the top-level blocks, by position among
   * the written ones, that it does not hold as the document does. Without it
   * only the blocks written anew are checked, one by one.
   */
  check: ((body: string, layout: BodyLayout) => ReadonlySet<number>) | null;
  /**
   * Reads a block written anew back, when the whole output is not checked:
   * a baseline read another way is read that way too.
   */
  readBlock?: ((markdown: string) => ProseMirrorNode | null) | undefined;
}

export type WriteStrategy = 'reused' | 'repaired' | 'generated';

export interface WriteResult {
  markdown: string;
  /**
   * `repaired` rewrote the blocks where the first output read back
   * differently; `generated` gave up on the baseline altogether.
   */
  strategy: WriteStrategy;
}

/** No markdown the writer can make reads back as the document. */
export class MarkdownWriteError extends Error {
  constructor(
    /**
     * The closest the writer got, with the source of every block but the
     * ones that failed, for diagnosis; it is not safe to save.
     */
    readonly markdown: string,
    readonly block: number,
  ) {
    super(
      `The document cannot be written as markdown that reads back the same (block ${block})`,
    );
    this.name = 'MarkdownWriteError';
  }
}

// Every block that reads differently is raised a level at once, so this is
// about the number of levels, not of blocks.
const MAX_REPAIRS = 6;
const MAX_LEVEL = 3;
// Bounds the work of finding the escapes a block needs.
const MAX_ESCAPE_TRIALS = 48;

/** Whether a delimiter run could open or close emphasis, as micromark reads. */
function classify(char: string | undefined): 0 | 1 | 2 {
  if (char === undefined || /\s/u.test(char)) {
    return 1;
  }
  return /[\p{P}\p{S}]/u.test(char) ? 2 : 0;
}

function flanks(
  delimiter: string,
  side: 'open' | 'close',
  before: string | undefined,
  after: string | undefined,
): boolean {
  const b = classify(before);
  const a = classify(after);
  // Emphasis, but not strikethrough, can open or close next to another
  // delimiter.
  const attention = (char: string | undefined) =>
    /^[*_]/.test(delimiter) && (char === '*' || char === '_' || char === '~');
  const open = a === 0 || (a === 2 && b !== 0) || attention(after);
  const close = b === 0 || (b === 2 && a !== 0) || attention(before);
  if (delimiter.startsWith('_')) {
    return side === 'open'
      ? open && (b !== 0 || !close)
      : close && (a !== 0 || !open);
  }
  return side === 'open' ? open : close;
}

function lastChar(text: string): string | undefined {
  return Array.from(text.slice(-2)).at(-1);
}

function firstChar(text: string): string | undefined {
  return Array.from(text.slice(0, 2))[0];
}

type DelimiterForm = 'style' | 'safe' | 'html';

interface MarkOccurrence {
  id: number;
  mark: Mark;
  form: DelimiterForm;
  open: number;
  openLength: number;
  close: number;
  closeLength: number;
  /** The text under the mark, as it is in the document. */
  text: string;
}

interface InlineEdges {
  /** Whether the piece starts or ends the textblock. */
  start: boolean;
  end: boolean;
  /** The output before the piece and the source after it. */
  before: string;
  after: string;
}

const WHOLE: InlineEdges = { start: true, end: true, before: '', after: '' };

export class MarkdownWriter {
  private readonly nodeWriters = new Map<string, NodeWriter>();
  private readonly markWriters = new Map<string, MarkToMarkdown>();
  private readonly escapes: EscapeRule[];
  readonly form: WrittenForm;

  constructor(
    private readonly parser: MarkdownParser,
    notations: readonly NotationDefinition[],
  ) {
    for (const notation of notations) {
      for (const [name, writer] of Object.entries(notation.nodes ?? {})) {
        const spec = typeof writer === 'function' ? { write: writer } : writer;
        const previous = this.nodeWriters.get(name);
        this.nodeWriters.set(
          name,
          previous
            ? {
                ...previous,
                ...spec,
                write: (node, context, next) =>
                  spec.write(node, context, () =>
                    previous.write(node, context, next),
                  ),
              }
            : spec,
        );
      }
      for (const [name, writer] of Object.entries(notation.marks ?? {})) {
        const previous = this.markWriters.get(name);
        if (typeof writer !== 'function') {
          this.markWriters.set(name, writer);
        } else if (previous) {
          this.markWriters.set(name, writer(previous));
        }
      }
    }
    this.escapes = notations.flatMap((notation) => notation.escapes ?? []);
    this.form = new WrittenForm({
      rawInline: parser.schema.marks[RAW_INLINE],
      rawBlockName: RAW_BLOCK,
      isUnwritten: (node) => this.isUnwritten(node),
      flanking: new Set(
        [...this.markWriters]
          .filter(([, writer]) => writer.flanking)
          .map(([name]) => name),
      ),
      readRaw: (text) => {
        try {
          return childrenOf(parser.parseBody(text).doc);
        } catch {
          return null;
        }
      },
      attrsOf: (node) =>
        this.nodeWriters.get(node.type.name)?.writtenAttrs?.(node.attrs) ??
        node.attrs,
      writtenAs: (node) =>
        this.nodeWriters.get(node.type.name)?.writtenAs?.(node) ?? null,
      writeSafe: (node) =>
        this.generate(node, null, {}, new Set(), {
          ...this.initialState(new Map(), false),
          reuse: false,
          escaping: 'safe',
          escapes: 'all',
          widen: 2,
        }),
    });
  }

  private get schema(): Schema {
    return this.parser.schema;
  }

  private initialState(
    styles: ReadonlyMap<string, string>,
    bareStart: boolean,
  ): WriteState {
    return {
      styles,
      escaping: 'minimal',
      reuse: true,
      bareStart,
      levels: new Map(),
      checkGenerated: false,
      preserve: false,
      keepSeparators: false,
      escapes: 'none',
      widen: 0,
      tags: false,
      counter: { candidates: 0 },
    };
  }

  /**
   * Writes the body of `doc`, reusing the source of `base` where it can.
   *
   * A block that changed is written at level 0 first: only what changed in
   * it is written anew, as is. Where the whole output reads back differently,
   * every block that does is raised a level at once. Level 1 escapes only the
   * characters that make the block read differently on its own, and rewrites
   * more of it only when that is not enough; level 2 also stops keeping the
   * separators around it and raises its neighbours, since one of them may
   * change what it means; level 3 escapes everything.
   */
  writeBody(
    doc: ProseMirrorNode,
    base: BaseDocument | null,
    styles: ReadonlyMap<string, string>,
    options: WriteBodyOptions,
  ): WriteResult {
    const unwritable = this.unwritableBlock(doc);
    if (unwritable !== -1) {
      throw new MarkdownWriteError('', unwritable);
    }
    const { check } = options;
    this.readBlock = options.readBlock;
    this.definitions = this.definitionsOf(doc);
    this.references = readDefinitions([
      ...(this.definitions ? [this.definitions.text] : []),
      ...(base?.detached?.values() ?? []),
    ]);
    const state = (levels: WriteState['levels']): WriteState => ({
      ...this.initialState(styles, options.bareStart),
      reuse: levels !== 'all',
      levels,
      checkGenerated: !check,
      preserve: !check,
      keepSeparators: Boolean(check),
    });
    if (!check) {
      return {
        markdown: this.writeDocument(doc, base, state(new Map())).markdown,
        strategy: 'reused',
      };
    }
    const levels = new Map<number, number>();
    let strategy: WriteStrategy = 'reused';
    let last: { markdown: string; differing: ReadonlySet<number> } | undefined;
    for (let repair = 0; repair <= MAX_REPAIRS; repair++) {
      const written = this.writeDocument(doc, base, state(levels));
      const differing = check(written.markdown, written.layout);
      if (differing.size === 0) {
        return { markdown: written.markdown, strategy };
      }
      strategy = 'repaired';
      last = { markdown: written.markdown, differing };
      let raised = false;
      for (const index of differing) {
        const level = (levels.get(index) ?? 0) + 1;
        if (level > MAX_LEVEL) {
          continue;
        }
        levels.set(index, level);
        raised = true;
        if (level >= 2) {
          for (const neighbour of [index - 1, index + 1]) {
            if (
              neighbour >= 0 &&
              neighbour < written.layout.length &&
              !levels.has(neighbour)
            ) {
              levels.set(neighbour, 1);
            }
          }
        }
      }
      if (!raised) {
        break;
      }
    }
    const generated = this.writeDocument(doc, base, state('all'));
    const differing = check(generated.markdown, generated.layout);
    if (differing.size === 0) {
      return { markdown: generated.markdown, strategy: 'generated' };
    }
    throw new MarkdownWriteError(
      last?.markdown ?? generated.markdown,
      Math.min(...(last?.differing ?? differing)),
    );
  }

  /**
   * The first top-level block holding a node or a mark that no definition
   * writes, as when a document's definitions lack the syntax the editor made
   * it with, or -1. Leaving it out would lose it unnoticed.
   */
  private unwritableBlock(doc: ProseMirrorNode): number {
    let found = -1;
    doc.forEach((block, _, index) => {
      if (found !== -1) {
        return;
      }
      const check = (node: ProseMirrorNode) => {
        if (
          node.marks.some((mark) => !this.markWriters.has(mark.type.name)) ||
          (!node.isText && !this.nodeWriters.has(node.type.name))
        ) {
          found = index;
        }
        return found === -1;
      };
      if (check(block)) {
        block.descendants(check);
      }
    });
    return found;
  }

  private writeDocument(
    doc: ProseMirrorNode,
    base: BaseDocument | null,
    state: WriteState,
  ): { markdown: string; layout: BodyLayout } {
    const layout: { start: number; end: number }[] = [];
    const body = this.sequence(
      childrenOf(doc),
      state.reuse ? base : null,
      {},
      state,
      { detached: base?.detached, layout },
    );
    if (!body) {
      return {
        markdown: base && !base.children.some(Boolean) ? base.trailing : '',
        layout,
      };
    }
    const leading =
      base?.leading.slice(0, base.leading.lastIndexOf('\n') + 1) ?? '';
    return {
      markdown: `${leading}${body}${base?.trailing ?? ''}`,
      layout: layout.map(({ start, end }) => ({
        start: start + leading.length,
        end: end + leading.length,
      })),
    };
  }

  /**
   * The first top-level block of `doc`, by position among the written ones,
   * that `read` does not hold, or -1.
   */
  difference(read: ProseMirrorNode, doc: ProseMirrorNode): number {
    const written = (node: ProseMirrorNode) =>
      childrenOf(node).filter((child) => !this.isUnwritten(child));
    const expected = written(doc);
    const actual = written(read);
    let at = 0;
    for (let index = 0; index < expected.length; index++) {
      const count = this.form.consume(expected[index], actual, at);
      if (count === -1) {
        return index;
      }
      at += count;
    }
    return at === actual.length ? -1 : Math.max(0, expected.length - 1);
  }

  /**
   * The top-level blocks of `doc`, by position among the written ones, that
   * `read` does not hold as `doc` does. `layout` tells which blocks of `read`
   * were written for which block of `doc`.
   */
  differences(
    read: ParsedBody,
    doc: ProseMirrorNode,
    layout: BodyLayout,
  ): Set<number> {
    const expected: ProseMirrorNode[] = [];
    doc.forEach((child) => {
      if (!this.isUnwritten(child)) {
        expected.push(child);
      }
    });
    const differing = new Set<number>();
    if (expected.length !== layout.length) {
      const first = this.difference(read.doc, doc);
      return new Set(first === -1 ? [] : [first]);
    }
    const owners = (start: number, end: number): number[] => {
      let first = 0;
      for (let i = 0; i < layout.length; i++) {
        if (layout[i].start <= start) {
          first = i;
        }
      }
      let last = first;
      while (last + 1 < layout.length && layout[last + 1].start < end) {
        last++;
      }
      return Array.from({ length: last - first + 1 }, (_, k) => first + k);
    };
    const assigned: ProseMirrorNode[][] = expected.map(() => []);
    let previous = 0;
    read.doc.forEach((child) => {
      if (this.isUnwritten(child)) {
        return;
      }
      const range = read.ranges.get(child);
      const indices = range ? owners(range.start, range.end) : [previous];
      if (indices.length > 1) {
        for (const index of indices) {
          differing.add(index);
        }
      }
      assigned[indices[0]].push(child);
      previous = indices.at(-1) ?? previous;
    });
    expected.forEach((node, index) => {
      if (!differing.has(index) && !this.form.holds(node, assigned[index])) {
        differing.add(index);
      }
    });
    return differing;
  }

  private readBlock: WriteBodyOptions['readBlock'];
  private references: Definitions = new Map();
  /** The document's link reference definitions, which any block can use. */
  private definitions: { text: string; blocks: ProseMirrorNode[] } | null =
    null;

  private definitionsOf(
    doc: ProseMirrorNode,
  ): { text: string; blocks: ProseMirrorNode[] } | null {
    const texts: string[] = [];
    doc.forEach((child) => {
      if (
        child.type.name === RAW_BLOCK &&
        DEFINITION_RE.test(child.textContent)
      ) {
        texts.push(child.textContent);
      }
    });
    if (texts.length === 0) {
      return null;
    }
    const text = texts.join('\n\n');
    try {
      return { text, blocks: childrenOf(this.parser.parseBody(text).doc) };
    } catch {
      return null;
    }
  }

  private readsAlone(markdown: string, node: ProseMirrorNode): boolean {
    try {
      if (this.readBlock) {
        const read = this.readBlock(markdown);
        return (
          read !== null &&
          this.difference(read, this.schema.topNodeType.create(null, node)) ===
            -1
        );
      }
      // Definitions elsewhere in the document can make text a link.
      const definitions = this.definitions;
      const read = this.parser.parseBody(
        definitions ? `${markdown}\n\n${definitions.text}` : markdown,
      ).doc;
      return (
        this.difference(
          read,
          this.schema.topNodeType.create(null, [
            node,
            ...(definitions?.blocks ?? []),
          ]),
        ) === -1
      );
    } catch {
      return false;
    }
  }

  /** Empty paragraphs have no markdown, so they are left out. */
  private isUnwritten(node: ProseMirrorNode): boolean {
    return (
      node.isTextblock &&
      node.childCount === 0 &&
      node.type === this.schema.topNodeType.contentMatch.defaultType
    );
  }

  private sequence(
    nodes: readonly ProseMirrorNode[],
    base: BaseContent | null,
    options: ChildrenOptions,
    state: WriteState,
    topLevel?: {
      detached?: ReadonlyMap<number, string> | undefined;
      layout: { start: number; end: number }[];
    },
  ): string {
    const skip =
      options.skip ?? ((child: ProseMirrorNode) => this.isUnwritten(child));
    const docChildren = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node, index }) => !skip(node, index));
    const baseChildren = (base?.children ?? [])
      .map((node, index) => ({ node, index }))
      .filter(
        (it): it is { node: BaseNode; index: number } =>
          it.node !== null && !skip(it.node.node, it.index),
      );
    const matches = matchSequences(
      docChildren.map(({ node }) => keyOf(node)),
      baseChildren.map(({ node }) => keyOf(node.node)),
    );
    const plans: ChildPlan[] = docChildren.map(({ node, index }, i) => {
      const match = baseChildren[matches[i]];
      return {
        node,
        index,
        base: match?.node ?? null,
        baseIndex: match?.index ?? -1,
        matched: Boolean(match),
      };
    });
    this.pairUnmatched(plans, baseChildren, matches);

    const levelOf = (i: number) =>
      !topLevel ? 0 : state.levels === 'all' ? 1 : (state.levels.get(i) ?? 0);
    const outputs: (string | null)[] = plans.map((plan, i) => {
      const text = plan.base?.text;
      if (
        !plan.matched ||
        text == null ||
        !state.reuse ||
        levelOf(i) > 0 ||
        !(options.reusable?.(text, plan.index) ?? true) ||
        (topLevel && i === 0 && state.bareStart && FENCE_START_RE.test(text))
      ) {
        return null;
      }
      return text;
    });
    const reused = outputs.map((output) => output !== null);
    plans.forEach((plan, i) => {
      const previous = plans[i - 1];
      const listMarker = this.nodeWriters.get(plan.node.type.name)?.listMarker;
      const sameList = (other: ChildPlan | undefined) =>
        listMarker && other && other.node.type === plan.node.type;
      const previousMarker =
        sameList(previous) && outputs[i - 1] != null
          ? listMarker?.(outputs[i - 1] as string)
          : undefined;
      if (
        outputs[i] !== null &&
        previousMarker !== undefined &&
        listMarker?.(outputs[i] as string) === previousMarker
      ) {
        outputs[i] = null;
        reused[i] = false;
      }
      if (outputs[i] !== null) {
        return;
      }
      const next = plans[i + 1];
      const nextOutput = outputs[i + 1];
      const avoid = new Set<string>();
      if (previousMarker !== undefined) {
        avoid.add(previousMarker);
      }
      const nextMarker =
        sameList(next) && nextOutput != null
          ? listMarker?.(nextOutput)
          : undefined;
      if (nextMarker !== undefined) {
        avoid.add(nextMarker);
      }
      const data = {
        ...options.data?.(plan.index),
        ...(topLevel && i === 0 && state.bareStart && { documentStart: true }),
      };
      const level = levelOf(i);
      const blockState: WriteState = topLevel
        ? {
            ...state,
            keepSeparators: state.keepSeparators && level < 2,
            counter: { candidates: 0 },
          }
        : state;
      outputs[i] =
        topLevel && (level > 0 || state.checkGenerated)
          ? this.writeChecked(plan, data, avoid, blockState, level)
          : this.generate(plan.node, plan.base, data, avoid, blockState);
    });

    if (topLevel?.detached?.size) {
      this.placeDetached(plans, outputs, reused, topLevel.detached);
    }

    const keepsSeparator = (i: number) =>
      state.keepSeparators && (!topLevel || levelOf(i) < 2);
    let text = '';
    plans.forEach((plan, i) => {
      if (i > 0) {
        const previous = plans[i - 1];
        // Source that is reused on both sides keeps what was between. Next to
        // a block written anew it can mean something else, so it is only
        // kept where the output is read back.
        const separator =
          ((reused[i - 1] && reused[i]) ||
            (keepsSeparator(i - 1) && keepsSeparator(i))) &&
          plan.baseIndex === previous.baseIndex + 1 &&
          previous.baseIndex !== -1 &&
          base
            ? base.separator(previous.baseIndex)
            : null;
        text +=
          separator ?? options.separator?.(previous.node, plan.node) ?? '\n\n';
      }
      const start = text.length;
      text += outputs[i];
      topLevel?.layout.push({ start, end: text.length });
    });
    return text;
  }

  /**
   * Source that belongs to no block goes right after the block it followed,
   * or the nearest one before it that is still there.
   */
  private placeDetached(
    plans: readonly ChildPlan[],
    outputs: (string | null)[],
    reused: readonly boolean[],
    detached: ReadonlyMap<number, string>,
  ): void {
    for (const [anchor, text] of detached) {
      const owner = plans.findIndex((plan) => plan.baseIndex === anchor);
      if (owner !== -1 && reused[owner]) {
        continue;
      }
      let target = owner;
      if (target === -1) {
        for (let i = plans.length - 1; i >= 0; i--) {
          if (plans[i].baseIndex !== -1 && plans[i].baseIndex < anchor) {
            target = i;
            break;
          }
        }
      }
      if (target === -1) {
        outputs[0] = `${text}\n\n${outputs[0] ?? ''}`;
      } else {
        outputs[target] = `${outputs[target] ?? ''}\n\n${text}`;
      }
    }
  }

  /**
   * Pairs nodes that changed with base nodes: first a base node with the
   * same content anywhere, so a moved block keeps its source, then one of the
   * same type between the same unchanged neighbours, so the children of an
   * edited container can still be reused.
   */
  private pairUnmatched(
    plans: ChildPlan[],
    baseChildren: readonly { node: BaseNode; index: number }[],
    matches: readonly number[],
  ): void {
    const used = new Set(matches.filter((match) => match !== -1));
    const byKey = new Map<string, number[]>();
    baseChildren.forEach(({ node }, j) => {
      if (!used.has(j)) {
        const key = keyOf(node.node);
        byKey.set(key, [...(byKey.get(key) ?? []), j]);
      }
    });
    const paired = [...matches];
    plans.forEach((plan, i) => {
      if (paired[i] !== -1) {
        return;
      }
      const j = byKey.get(keyOf(plan.node))?.shift();
      if (j === undefined) {
        return;
      }
      used.add(j);
      plan.base = baseChildren[j].node;
      plan.baseIndex = baseChildren[j].index;
      plan.matched = true;
      paired[i] = j;
    });
    let gapStart = 0;
    let baseStart = 0;
    for (let i = 0; i <= plans.length; i++) {
      if (i < plans.length && matches[i] === -1) {
        continue;
      }
      const baseEnd = i < plans.length ? matches[i] : baseChildren.length;
      for (let k = gapStart; k < i; k++) {
        if (paired[k] !== -1) {
          continue;
        }
        for (let j = baseStart; j < baseEnd; j++) {
          if (
            !used.has(j) &&
            baseChildren[j].node.node.type === plans[k].node.type
          ) {
            used.add(j);
            plans[k].base = baseChildren[j].node;
            plans[k].baseIndex = baseChildren[j].index;
            break;
          }
        }
      }
      gapStart = i + 1;
      baseStart = baseEnd + 1;
    }
  }

  /** Writes a top-level block so that it reads back on its own. */
  private writeChecked(
    plan: ChildPlan,
    data: Record<string, unknown>,
    avoid: ReadonlySet<string>,
    state: WriteState,
    level: number,
  ): string {
    const write = (attempt: Partial<WriteState>) => {
      const counter = { candidates: 0 };
      const output = this.generate(plan.node, plan.base, data, avoid, {
        ...state,
        ...attempt,
        counter,
      });
      return { output, candidates: counter.candidates };
    };
    const reads = (output: string) => this.readsAlone(output, plan.node);
    let first: string | undefined;
    if (level < MAX_LEVEL) {
      // Tags last: delimiters can be read into a bare URL before them, which
      // no escape prevents but a tag ends.
      const tries: Partial<WriteState>[] = state.preserve
        ? [{ widen: 0 }]
        : [{ widen: 0 }, { widen: 1 }, { widen: 2 }, { widen: 2, tags: true }];
      for (const attempt of tries) {
        const none = write({ ...attempt, escapes: 'none' });
        first ??= none.output;
        if (reads(none.output)) {
          return none.output;
        }
        const escaped = this.fewestEscapes(
          none.candidates,
          (escapes) => write({ ...attempt, escapes }).output,
          reads,
        );
        if (escaped !== null) {
          return escaped;
        }
      }
      if (state.preserve && first !== undefined) {
        // The baseline cannot be read the way the output is, so nothing
        // proves rewriting more would be right: unedited text stays.
        return first;
      }
    }
    const attempts: Partial<WriteState>[] = [
      { escaping: 'safe', escapes: 'all', widen: 0 },
      { escaping: 'safe', escapes: 'all', widen: 2, reuse: false },
      { escaping: 'safe', escapes: 'all', widen: 2, reuse: false, tags: true },
    ];
    let fallback = '';
    for (const attempt of attempts) {
      const { output } = write(attempt);
      if (reads(output)) {
        return output;
      }
      fallback ||= output;
    }
    return first ?? fallback;
  }

  /**
   * The output with only the escapes it needs to read back, or `null` when
   * even escaping every candidate does not. Escapes are dropped in halving
   * chunks, so a block needing few of many candidates is found in few
   * trials. Dropping them from the front keeps the last delimiter of a pair
   * that would read as syntax, from the back the first, so both are
   * escaped: `\*not\*` rather than `*not\*`.
   */
  private fewestEscapes(
    count: number,
    write: (escapes: EscapeSelection) => string,
    reads: (output: string) => boolean,
  ): string | null {
    if (count === 0 || !reads(write('all'))) {
      return null;
    }
    const all = Array.from({ length: count }, (_, i) => i);
    const needed = (order: number[]) => {
      let escaped = new Set(order);
      const queue: number[][] = [order];
      let trials = 0;
      while (queue.length > 0 && trials < MAX_ESCAPE_TRIALS) {
        const chunk = queue.shift() as number[];
        const trial = new Set([...escaped].filter((i) => !chunk.includes(i)));
        trials++;
        if (reads(write(trial))) {
          escaped = trial;
        } else if (chunk.length > 1) {
          const half = Math.ceil(chunk.length / 2);
          queue.unshift(chunk.slice(0, half), chunk.slice(half));
        }
      }
      return escaped;
    };
    const union = new Set([...needed(all), ...needed([...all].reverse())]);
    const output = write(union);
    return reads(output) ? output : write('all');
  }

  private generate(
    node: ProseMirrorNode,
    base: BaseNode | null,
    data: Readonly<Record<string, unknown>>,
    avoidMarkers: ReadonlySet<string>,
    state: WriteState,
  ): string {
    const context: WriteContext = {
      schema: this.schema,
      style: (key) =>
        state.styles.get(key) ?? this.parser.styleDefaults.get(key) ?? '',
      escaping: state.escaping,
      data,
      avoidMarkers,
      base,
      inline: (textblock, inlineData) =>
        this.inline(
          textblock,
          inlineData
            ? { ...context, data: { ...data, ...inlineData } }
            : context,
          state,
          textblock === node ? base : null,
        ),
      children: (container, options) =>
        this.sequence(
          childrenOf(container),
          container === node && state.reuse ? (base?.content() ?? null) : null,
          options ?? {},
          state,
        ),
      escape: (text) => this.escapeAll(text),
      definition: (label) => this.references.get(labelKey(label)),
    };
    const writer = this.nodeWriters.get(node.type.name);
    if (writer) {
      return writer.write(node, context, () =>
        node.isTextblock ? context.inline(node) : context.children(node),
      );
    }
    return node.isTextblock ? context.inline(node) : context.children(node);
  }

  private escapeAll(text: string): string {
    return this.escapeText(
      text,
      { ...this.initialState(new Map(), false), escapes: 'all' },
      '\u0000',
      '\u0000',
    );
  }

  /**
   * Escapes the candidates `state` selects in `text`. Every character an
   * escape rule matches is one candidate, counted in `state.counter` in the
   * order they are met, so a selection names the same characters each time
   * the block is written. `before` and `after` are what surrounds the text,
   * with `\n` for a line break or the edges of the block.
   */
  private escapeText(
    text: string,
    state: WriteState,
    before: string,
    after: string,
  ): string {
    const subject = `${before}${text}${after}`;
    const actions = new Map<number, 'backslash' | 'entity'>();
    for (const rule of this.escapes) {
      for (const match of subject.matchAll(rule.pattern)) {
        const index = match.index - before.length;
        if (index < 0 || index >= text.length) {
          continue;
        }
        if (rule.entity) {
          actions.set(index, 'entity');
        } else if (!actions.has(index)) {
          actions.set(index, 'backslash');
        }
      }
    }
    if (actions.size === 0) {
      return text;
    }
    let output = '';
    for (let index = 0; index < text.length; index++) {
      const action = actions.get(index);
      const char = text[index];
      if (action && this.selects(state)) {
        output += action === 'entity' ? codePoint(char) : `\\${char}`;
      } else {
        output += char;
      }
    }
    return output;
  }

  /** Takes the next escape candidate and tells whether it is escaped. */
  private selects(state: WriteState): boolean {
    const id = state.counter.candidates++;
    const { escapes } = state;
    return escapes === 'all' || (escapes !== 'none' && escapes.has(id));
  }

  private markWriter(mark: Mark): MarkToMarkdown | undefined {
    return this.markWriters.get(mark.type.name);
  }

  private delimiter(
    mark: Mark,
    side: 'open' | 'close',
    context: WriteContext,
    form: DelimiterForm = 'style',
    text = '',
  ): string {
    const writer = this.markWriter(mark);
    if (form === 'html' && writer?.html) {
      return side === 'open'
        ? openingTag(
            { tag: writer.html, capture: [] },
            {},
            writer.htmlAttributes?.(mark),
          )
        : `</${writer.html}>`;
    }
    const value = writer?.[side];
    const used =
      form === 'safe' ? { ...context, escaping: 'safe' as const } : context;
    return typeof value === 'function'
      ? value(mark, used, text)
      : (value ?? '');
  }

  private inline(
    textblock: ProseMirrorNode,
    context: WriteContext,
    state: WriteState,
    base: BaseNode | null,
  ): string {
    const pieces: readonly InlinePiece[] =
      state.reuse && state.widen < 2 && base
        ? (inlinePieces(textblock, base, state.widen, state.preserve) ?? [
            { from: 0, to: textblock.content.size },
          ])
        : [{ from: 0, to: textblock.content.size }];
    const start = state.counter.candidates;
    const output = this.composeInline(textblock, pieces, context, state, true);
    if (output.implied === 0 || this.inlineReadsBack(output.text, textblock)) {
      return output.text;
    }
    state.counter.candidates = start;
    return this.composeInline(textblock, pieces, context, state, false).text;
  }

  private composeInline(
    textblock: ProseMirrorNode,
    pieces: readonly InlinePiece[],
    context: WriteContext,
    state: WriteState,
    allowImplied: boolean,
  ): { text: string; implied: number } {
    let text = '';
    let implied = 0;
    const size = textblock.content.size;
    pieces.forEach((piece, index) => {
      if ('text' in piece) {
        let source = (piece as SourceSegment).text;
        // A line break can neither start nor end a textblock in markdown.
        if (piece.from === 0) {
          source = source.replace(/^\n+/, '');
        }
        if (piece.to === size) {
          source = source.replace(/\n+$/, '');
        }
        text += source;
        return;
      }
      const next = pieces[index + 1];
      const after = next && 'text' in next ? next.text : '';
      if (piece.from === 0 && piece.to === size) {
        const whole = this.inlineWith(textblock, context, state, allowImplied, {
          ...WHOLE,
          before: text,
        });
        text += whole.text;
        implied += whole.implied;
        return;
      }
      let slice: ProseMirrorNode;
      try {
        slice = textblock.type.create(
          textblock.attrs,
          textblock.content.cut(piece.from, piece.to),
        );
      } catch {
        return;
      }
      const output = this.inlineWith(slice, context, state, allowImplied, {
        start: piece.from === 0,
        end: piece.to === size,
        before: text,
        after,
      });
      text += output.text;
      implied += output.implied;
    });
    return { text, implied };
  }

  // A mark left out because markdown reads it into the text anyway, such as a
  // bare URL, is only left out when the textblock reads back with it.
  private inlineReadsBack(markdown: string, textblock: ProseMirrorNode) {
    const { paragraph } = this.schema.nodes;
    if (!paragraph) {
      return false;
    }
    try {
      const read = this.parser.parseBody(markdown).doc;
      const expected = this.schema.topNodeType.create(
        null,
        paragraph.create(null, textblock.content),
      );
      return this.difference(read, expected) === -1;
    } catch {
      return false;
    }
  }

  /**
   * Writes the content of a textblock, or a piece of it between source that
   * is reused. Marks whose delimiters could not open or close where they are
   * are written again in another form, see `MarkToMarkdown.html`.
   */
  private inlineWith(
    textblock: ProseMirrorNode,
    context: WriteContext,
    state: WriteState,
    allowImplied: boolean,
    edges: InlineEdges,
  ): { text: string; implied: number } {
    const start = state.counter.candidates;
    const forms = new Map<number, DelimiterForm>();
    let result = this.inlinePass(
      textblock,
      context,
      state,
      allowImplied,
      edges,
      forms,
    );
    for (let pass = 0; pass < 3; pass++) {
      const failing = this.unflanked(result, edges, context, forms);
      if (failing.size === 0) {
        break;
      }
      for (const [id, form] of failing) {
        forms.set(id, form);
      }
      state.counter.candidates = start;
      result = this.inlinePass(
        textblock,
        context,
        state,
        allowImplied,
        edges,
        forms,
      );
    }
    return { text: result.text, implied: result.implied };
  }

  /** The marks whose delimiters do not flank, with the form to use instead. */
  private unflanked(
    result: { text: string; occurrences: readonly MarkOccurrence[] },
    edges: InlineEdges,
    context: WriteContext,
    forms: ReadonlyMap<number, DelimiterForm>,
  ): Map<number, DelimiterForm> {
    const failing = new Map<number, DelimiterForm>();
    const { text } = result;
    const charBefore = (index: number) =>
      index > 0
        ? lastChar(text.slice(0, index))
        : edges.start
          ? undefined
          : lastChar(edges.before);
    const charAfter = (index: number) =>
      index < text.length
        ? firstChar(text.slice(index))
        : edges.end
          ? undefined
          : firstChar(edges.after);
    const fits = (occurrence: MarkOccurrence, open: string, close: string) =>
      flanks(
        open,
        'open',
        charBefore(occurrence.open),
        charAfter(occurrence.open + occurrence.openLength),
      ) &&
      flanks(
        close,
        'close',
        charBefore(occurrence.close),
        charAfter(occurrence.close + occurrence.closeLength),
      );
    for (const occurrence of result.occurrences) {
      const writer = this.markWriter(occurrence.mark);
      if (!writer?.flanking || occurrence.form === 'html') {
        continue;
      }
      const open = text.slice(
        occurrence.open,
        occurrence.open + occurrence.openLength,
      );
      const close = text.slice(
        occurrence.close,
        occurrence.close + occurrence.closeLength,
      );
      if (!open || fits(occurrence, open, close)) {
        continue;
      }
      const safeOpen = this.delimiter(occurrence.mark, 'open', context, 'safe');
      const safeClose = this.delimiter(
        occurrence.mark,
        'close',
        context,
        'safe',
      );
      if (
        occurrence.form === 'style' &&
        safeOpen !== open &&
        fits(occurrence, safeOpen, safeClose)
      ) {
        failing.set(occurrence.id, 'safe');
      } else if (writer.html && forms.get(occurrence.id) !== 'html') {
        failing.set(occurrence.id, 'html');
      }
    }
    return failing;
  }

  private inlinePass(
    textblock: ProseMirrorNode,
    context: WriteContext,
    state: WriteState,
    allowImplied: boolean,
    edges: InlineEdges,
    forms: ReadonlyMap<number, DelimiterForm>,
  ): { text: string; implied: number; occurrences: MarkOccurrence[] } {
    const children = childrenOf(textblock);
    const active: { mark: Mark; occurrence: MarkOccurrence }[] = [];
    const occurrences: MarkOccurrence[] = [];
    let output = '';
    let implied = 0;
    // What escape rules see before text: its line so far, after a `\n` when
    // that is where the line starts.
    const lineBefore = (pending: string) => {
      const preceding = edges.before + output + pending;
      const newline = preceding.lastIndexOf('\n');
      const line =
        newline !== -1
          ? preceding.slice(newline)
          : `${edges.start ? '\n' : '\u0000'}${preceding}`;
      return line.length > 64 ? `\u0000${line.slice(-64)}` : line;
    };
    const atLineStart = () =>
      output
        ? output.endsWith('\n')
        : edges.start || edges.before.endsWith('\n');

    const closeTo = (depth: number) => {
      while (active.length > depth) {
        const { mark, occurrence } = active.pop() as (typeof active)[number];
        occurrence.close = output.length;
        const close = this.delimiter(
          mark,
          'close',
          context,
          occurrence.form,
          occurrence.text,
        );
        occurrence.closeLength = close.length;
        output += close;
      }
    };

    const outerMarks = (index: number, count = false): readonly Mark[] => {
      const child = children[index];
      if (!child) {
        return [];
      }
      return child.marks.filter((mark) => {
        const writer = this.markWriter(mark);
        if (writer?.run) {
          return false;
        }
        const left =
          allowImplied &&
          context.escaping === 'minimal' &&
          writer?.implied?.(
            {
              node: child,
              previous: children[index - 1],
              next: children[index + 1],
              afterNext: children[index + 2],
            },
            context,
          );
        if (left && count) {
          implied++;
        }
        return !left;
      });
    };

    children.forEach((child, index) => {
      const marks = outerMarks(index, true);
      const continuation = (mark: Mark) => {
        let length = 0;
        while (outerMarks(index + length).some((it) => it.eq(mark))) {
          length++;
        }
        return length;
      };
      let keep = 0;
      while (keep < active.length && active[keep].mark.isInSet(marks)) {
        keep++;
      }
      // A mark opening here that goes on longer than one already open has to
      // be outside it, so that one is closed and opened again inside.
      const longest = Math.max(
        0,
        ...marks
          .filter((mark) => !active.some((it) => it.mark.eq(mark)))
          .map(continuation),
      );
      while (keep > 0 && continuation(active[keep - 1].mark) < longest) {
        keep--;
      }
      closeTo(keep);
      const isActive = (mark: Mark) => active.some((it) => it.mark.eq(mark));
      // Whitespace is written outside flanking delimiters, which would be
      // left with nothing between them.
      const blank = child.isText && !/\S/.test(child.text ?? '');
      const opening = marks
        .filter((mark) => !isActive(mark))
        .map((mark, order) => ({ mark, order, length: continuation(mark) }))
        .filter(
          ({ mark, length }) =>
            !(blank && length === 1 && this.markWriter(mark)?.flanking),
        )
        .sort((a, b) => b.length - a.length || a.order - b.order)
        .map(({ mark }) => mark);

      const opens = opening.map((mark) => {
        const id = occurrences.length;
        const form =
          forms.get(id) ??
          (state.tags && this.markWriter(mark)?.html ? 'html' : 'style');
        const occurrence: MarkOccurrence = {
          id,
          mark,
          form,
          open: 0,
          openLength: 0,
          close: 0,
          closeLength: 0,
          text: '',
        };
        occurrences.push(occurrence);
        return {
          mark,
          occurrence,
          text: this.delimiter(mark, 'open', context, form),
        };
      });

      let content: string;
      let leading = '';
      let trailing = '';
      const first = index === 0 && edges.start;
      const last = index === children.length - 1 && edges.end;
      if (child.isText) {
        let text = child.text ?? '';
        // A line break can neither start nor end a textblock in markdown.
        if (first) {
          text = text.replace(/^\n+/, '');
        }
        if (last) {
          text = text.replace(/\n+$/, '');
        }
        const runMark = child.marks.find((mark) => this.markWriter(mark)?.run);
        const verbatim = child.marks.some(
          (mark) => this.markWriter(mark)?.verbatim,
        );
        if (runMark) {
          content = this.markWriter(runMark)?.run?.(text, runMark) ?? text;
        } else if (verbatim) {
          content = text;
        } else {
          let core = text;
          const flanking = (list: readonly Mark[]) =>
            list.some((mark) => this.markWriter(mark)?.flanking);
          if (flanking(opening)) {
            leading = core.match(/^\s*/)?.[0] ?? '';
            core = core.slice(leading.length);
          }
          const next = outerMarks(index + 1);
          const ending = [...active.map((it) => it.mark), ...opening].filter(
            (mark) => !mark.isInSet(next),
          );
          if (flanking(ending)) {
            trailing = core.match(/\s*$/)?.[0] ?? '';
            core = core.slice(0, core.length - trailing.length);
          }
          // What follows is a delimiter, written as punctuation, unless it is
          // known.
          const following = children[index + 1];
          // Closing delimiters come before trailing whitespace.
          const after = trailing
            ? ending.length > 0
              ? '!'
              : trailing
            : !following
              ? edges.end
                ? '\n'
                : (firstChar(edges.after) ?? '\u0000')
              : ending.length === 0 &&
                  following.isText &&
                  following.marks.every((mark) => mark.isInSet(child.marks))
                ? (firstChar(following.text ?? '') ?? '!')
                : '!';
          content = this.escapeText(
            core,
            state,
            lineBefore(leading + opens.map((it) => it.text).join('')),
            after,
          );
        }
      } else if (child.type.spec.linebreakReplacement && (first || last)) {
        // A line break can neither start nor end a textblock in markdown.
        content = '';
      } else {
        const writer = this.nodeWriters.get(child.type.name);
        content = writer?.write(child, context, () => '') ?? '';
      }

      // Whitespace that markdown would strip at the start or end of a line.
      if (leading && atLineStart() && this.selects(state)) {
        leading = codePoint(leading[0]) + leading.slice(1);
      }
      if (trailing && last && this.selects(state)) {
        trailing = trailing.slice(0, -1) + codePoint(trailing.slice(-1));
      }
      output += leading;
      for (const { mark, occurrence, text } of opens) {
        occurrence.open = output.length;
        occurrence.openLength = text.length;
        output += text;
        active.push({ mark, occurrence });
      }
      output += content;
      for (const { occurrence } of active) {
        occurrence.text += child.text ?? '';
      }
      if (trailing) {
        const next = outerMarks(index + 1);
        let depth = active.length;
        for (let i = 0; i < active.length; i++) {
          if (!active[i].mark.isInSet(next)) {
            depth = i;
            break;
          }
        }
        closeTo(depth);
        output += trailing;
      }
    });
    closeTo(0);
    return { text: output, implied, occurrences };
  }
}
