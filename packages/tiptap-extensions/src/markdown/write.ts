import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import type { BaseContent, BaseDocument, BaseNode } from './base';
import { keyOf, matchSequences } from './match';
import type {
  ChildrenOptions,
  EscapeRule,
  MarkToMarkdown,
  NodeWriter,
  NotationDefinition,
  WriteContext,
} from './notation';
import { type MarkdownParser, RAW_BLOCK, RAW_INLINE } from './parse';
import { firstDifference, WrittenForm } from './written';

interface WriteState {
  styles: ReadonlyMap<string, string>;
  escaping: 'minimal' | 'safe';
  /** Whether the source of unchanged nodes is reused. */
  reuse: boolean;
  /** Whether no frontmatter precedes the body being written. */
  bareStart: boolean;
  /**
   * Top-level blocks, by position among the written ones, written anew and
   * checked: 1 tries minimal escaping first, 2 escapes everything at once.
   */
  forced: ReadonlyMap<number, 1 | 2> | 'all';
  /** Whether every top-level block written anew is read back on its own. */
  checkGenerated: boolean;
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

export interface WriteBodyOptions {
  bareStart: boolean;
  /**
   * Reads a body back and returns the first top-level block, by position
   * among the written ones, that it does not hold as the document does, or
   * -1. Without it only the blocks written anew are checked, one by one.
   */
  check: ((body: string) => number) | null;
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
   * `repaired` rewrote the blocks around a place where the first output read
   * back differently; `generated` gave up on the baseline altogether.
   */
  strategy: WriteStrategy;
}

/** No markdown the writer can make reads back as the document. */
export class MarkdownWriteError extends Error {
  constructor(
    /** The closest the writer got, for diagnosis; it is not safe to save. */
    readonly markdown: string,
    readonly block: number,
  ) {
    super(
      `The document cannot be written as markdown that reads back the same (block ${block})`,
    );
    this.name = 'MarkdownWriteError';
  }
}

const MAX_REPAIRS = 8;

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
        this.markWriters.set(name, writer);
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
      writeInline: (node) =>
        this.generate(node, null, {}, new Set(), {
          styles: new Map(),
          escaping: 'minimal',
          reuse: false,
          bareStart: false,
          forced: new Map(),
          checkGenerated: false,
        }),
    });
  }

  private get schema(): Schema {
    return this.parser.schema;
  }

  /** Writes the body of `doc`, reusing the source of `base` where it can. */
  writeBody(
    doc: ProseMirrorNode,
    base: BaseDocument | null,
    styles: ReadonlyMap<string, string>,
    options: WriteBodyOptions,
  ): WriteResult {
    const state = (forced: WriteState['forced']): WriteState => ({
      styles,
      escaping: 'minimal',
      reuse: forced !== 'all',
      bareStart: options.bareStart,
      forced,
      checkGenerated: !options.check,
    });
    const { check } = options;
    this.readBlock = options.readBlock;
    if (!check) {
      return {
        markdown: this.writeDocument(doc, base, state(new Map())),
        strategy: 'reused',
      };
    }
    // Reading the whole output back checks every block in it, so blocks are
    // only checked one by one around a place where it reads differently.
    const forced = new Map<number, 1 | 2>();
    let strategy: WriteStrategy = 'reused';
    for (let repair = 0; repair <= MAX_REPAIRS; repair++) {
      const markdown = this.writeDocument(doc, base, state(forced));
      const difference = check(markdown);
      if (difference === -1) {
        return { markdown, strategy };
      }
      strategy = 'repaired';
      // The block is written anew first. If it still reads differently, it
      // reads well only on its own, so it is escaped in full and its
      // neighbours are written anew: one of them changes what it means, e.g.
      // a list it now joins or a reference definition.
      const level = forced.get(difference);
      if (level === 2) {
        break;
      }
      forced.set(difference, level === 1 ? 2 : 1);
      if (level === 1) {
        for (const index of [difference - 1, difference + 1]) {
          if (index >= 0 && !forced.has(index)) {
            forced.set(index, 1);
          }
        }
      }
    }
    const markdown = this.writeDocument(doc, base, state('all'));
    const difference = check(markdown);
    if (difference === -1) {
      return { markdown, strategy: 'generated' };
    }
    throw new MarkdownWriteError(markdown, difference);
  }

  private writeDocument(
    doc: ProseMirrorNode,
    base: BaseDocument | null,
    state: WriteState,
  ): string {
    const body = this.sequence(
      childrenOf(doc),
      state.reuse ? base : null,
      {},
      state,
      true,
      base?.detached,
    );
    if (!body) {
      return base && !base.children.some(Boolean) ? base.trailing : '';
    }
    const leading = base?.leading.slice(0, base.leading.lastIndexOf('\n') + 1);
    return `${leading ?? ''}${body}${base?.trailing ?? ''}`;
  }

  /** Where `markdown` stops reading as `doc`, see `WriteBodyOptions.check`. */
  difference(read: ProseMirrorNode, doc: ProseMirrorNode): number {
    return firstDifference(
      this.form.blocks(doc, true),
      this.form.blocks(read, false),
    );
  }

  private readBlock: WriteBodyOptions['readBlock'];

  private readsAlone(markdown: string, node: ProseMirrorNode): boolean {
    try {
      const read =
        this.readBlock?.(markdown) ?? this.parser.parseBody(markdown).doc;
      return (
        this.difference(read, this.schema.topNodeType.create(null, node)) === -1
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
    topLevel = false,
    detached?: ReadonlyMap<number, string>,
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

    const forcedLevel = (i: number) =>
      !topLevel ? undefined : state.forced === 'all' ? 2 : state.forced.get(i);
    const isForced = (i: number) => forcedLevel(i) !== undefined;
    const outputs: (string | null)[] = plans.map((plan, i) => {
      const text = plan.base?.text;
      if (
        !plan.matched ||
        text == null ||
        !state.reuse ||
        isForced(i) ||
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
      outputs[i] =
        topLevel && (isForced(i) || state.checkGenerated)
          ? this.writeChecked(plan, data, avoid, state, forcedLevel(i) === 2)
          : this.generate(plan.node, plan.base, data, avoid, state);
    });

    if (topLevel && detached?.size) {
      this.placeDetached(plans, outputs, reused, detached);
    }

    let text = '';
    plans.forEach((plan, i) => {
      if (i > 0) {
        const previous = plans[i - 1];
        // Only source that is reused on both sides keeps what was between:
        // next to a block written anew it can mean something else.
        const separator =
          reused[i - 1] &&
          reused[i] &&
          plan.baseIndex === previous.baseIndex + 1 &&
          base
            ? base.separator(previous.baseIndex)
            : null;
        text +=
          separator ?? options.separator?.(previous.node, plan.node) ?? '\n\n';
      }
      text += outputs[i];
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
   * Pairs nodes that changed with base nodes of the same type between the
   * same unchanged neighbours, so the children of an edited container can
   * still be reused.
   */
  private pairUnmatched(
    plans: ChildPlan[],
    baseChildren: readonly { node: BaseNode; index: number }[],
    matches: readonly number[],
  ): void {
    let gapStart = 0;
    let baseStart = 0;
    for (let i = 0; i <= plans.length; i++) {
      if (i < plans.length && matches[i] === -1) {
        continue;
      }
      const baseEnd = i < plans.length ? matches[i] : baseChildren.length;
      const used = new Set<number>();
      for (let k = gapStart; k < i; k++) {
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
    escapeAll = false,
  ): string {
    const attempts: Pick<WriteState, 'escaping' | 'reuse'>[] = [
      ...(escapeAll
        ? []
        : [{ escaping: 'minimal' as const, reuse: state.reuse }]),
      { escaping: 'safe', reuse: state.reuse },
      { escaping: 'safe', reuse: false },
    ];
    let fallback: string | undefined;
    for (const attempt of attempts) {
      const output = this.generate(plan.node, plan.base, data, avoid, {
        ...state,
        ...attempt,
      });
      if (this.readsAlone(output, plan.node)) {
        return output;
      }
      fallback ??= attempt.escaping === 'safe' ? output : undefined;
    }
    return fallback ?? '';
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
        ),
      children: (container, options) =>
        this.sequence(
          childrenOf(container),
          container === node && state.reuse ? (base?.content() ?? null) : null,
          options ?? {},
          { ...state, forced: new Map() },
        ),
      escape: (text) => this.escapeText(text, false, false),
    };
    const writer = this.nodeWriters.get(node.type.name);
    if (writer) {
      return writer.write(node, context, () =>
        node.isTextblock ? context.inline(node) : context.children(node),
      );
    }
    return node.isTextblock ? context.inline(node) : context.children(node);
  }

  private escapeText(text: string, lineStart: boolean, blockEnd: boolean) {
    const subject = `${lineStart ? '\n' : '\u0000'}${text}${blockEnd ? '\n' : '\u0000'}`;
    const actions = new Map<number, 'backslash' | 'entity'>();
    for (const rule of this.escapes) {
      for (const match of subject.matchAll(rule.pattern)) {
        const index = match.index - 1;
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
      output +=
        action === 'entity'
          ? codePoint(char)
          : action === 'backslash'
            ? `\\${char}`
            : char;
    }
    return output;
  }

  private markWriter(mark: Mark): MarkToMarkdown | undefined {
    return this.markWriters.get(mark.type.name);
  }

  private delimiter(
    mark: Mark,
    side: 'open' | 'close',
    context: WriteContext,
  ): string {
    const writer = this.markWriter(mark);
    const value = writer?.[side];
    return typeof value === 'function' ? value(mark, context) : (value ?? '');
  }

  private inline(textblock: ProseMirrorNode, context: WriteContext): string {
    const output = this.inlineWith(textblock, context, true);
    if (output.implied === 0 || this.inlineReadsBack(output.text, textblock)) {
      return output.text;
    }
    return this.inlineWith(textblock, context, false).text;
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

  private inlineWith(
    textblock: ProseMirrorNode,
    context: WriteContext,
    allowImplied: boolean,
  ): { text: string; implied: number } {
    const children = childrenOf(textblock);
    const active: Mark[] = [];
    let output = '';
    let implied = 0;

    const closeTo = (depth: number) => {
      while (active.length > depth) {
        const mark = active.pop() as Mark;
        output += this.delimiter(mark, 'close', context);
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
      let keep = 0;
      while (keep < active.length && active[keep].isInSet(marks)) {
        keep++;
      }
      closeTo(keep);

      const continuation = (mark: Mark) => {
        let length = 0;
        while (outerMarks(index + length).some((it) => it.eq(mark))) {
          length++;
        }
        return length;
      };
      const opening = marks
        .filter((mark) => !mark.isInSet(active))
        .map((mark, order) => ({ mark, order, length: continuation(mark) }))
        .sort((a, b) => b.length - a.length || a.order - b.order)
        .map(({ mark }) => mark);

      let content: string;
      let leading = '';
      let trailing = '';
      if (child.isText) {
        let text = child.text ?? '';
        // A line break can neither start nor end a textblock in markdown.
        if (index === 0) {
          text = text.replace(/^\n+/, '');
        }
        if (index === children.length - 1) {
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
          const ending = [...active, ...opening].filter(
            (mark) => !mark.isInSet(next),
          );
          if (flanking(ending)) {
            trailing = core.match(/\s*$/)?.[0] ?? '';
            core = core.slice(0, core.length - trailing.length);
          }
          const lineStart =
            (output + leading).endsWith('\n') || !(output + leading);
          content =
            context.escaping === 'safe'
              ? this.escapeText(
                  core,
                  lineStart && opening.length === 0,
                  index === children.length - 1 && !trailing,
                )
              : core;
        }
      } else if (
        child.type.spec.linebreakReplacement &&
        (index === 0 || index === children.length - 1)
      ) {
        // A line break can neither start nor end a textblock in markdown.
        content = '';
      } else {
        const writer = this.nodeWriters.get(child.type.name);
        content = writer?.write(child, context, () => '') ?? '';
      }

      if (
        leading &&
        context.escaping === 'safe' &&
        (!output || output.endsWith('\n'))
      ) {
        leading = codePoint(leading[0]) + leading.slice(1);
      }
      if (
        trailing &&
        context.escaping === 'safe' &&
        index === children.length - 1
      ) {
        trailing = trailing.slice(0, -1) + codePoint(trailing.slice(-1));
      }
      output += leading;
      for (const mark of opening) {
        output += this.delimiter(mark, 'open', context);
        active.push(mark);
      }
      output += content;
      if (trailing) {
        const next = outerMarks(index + 1);
        let depth = active.length;
        for (let i = 0; i < active.length; i++) {
          if (!active[i].isInSet(next)) {
            depth = i;
            break;
          }
        }
        closeTo(depth);
        output += trailing;
      }
    });
    closeTo(0);
    return { text: output, implied };
  }
}
