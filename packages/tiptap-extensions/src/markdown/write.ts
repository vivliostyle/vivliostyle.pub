import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import type { BaseContent, BaseDocument, BaseNode } from './base';
import type {
  ChildrenOptions,
  EscapeRule,
  MarkToMarkdown,
  NodeWriter,
  NotationDefinition,
  WriteContext,
} from './notation';
import type { MarkdownParser, ParsedBody } from './parse';

const keys = new WeakMap<ProseMirrorNode, string>();

/** Two nodes are the same content exactly when their keys are equal. */
export function keyOf(node: ProseMirrorNode): string {
  let key = keys.get(node);
  if (key === undefined) {
    key = JSON.stringify(node.toJSON());
    keys.set(node, key);
  }
  return key;
}

// Beyond this many cells the middle of two sequences is left unmatched
// rather than spending quadratic time on it.
const MAX_LCS_CELLS = 4_000_000;

/** For each item of `a`, the index of the item of `b` it is matched with. */
export function matchSequences(
  a: readonly string[],
  b: readonly string[],
): number[] {
  const matches = a.map(() => -1);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    matches[head] = head;
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    matches[a.length - 1 - tail] = b.length - 1 - tail;
    tail++;
  }
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) {
    return matches;
  }
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] =
        a[head + i] === b[head + j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[head + i] === b[head + j]) {
      matches[head + i] = head + j;
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matches;
}

interface WriteState {
  styles: ReadonlyMap<string, string>;
  escaping: 'minimal' | 'safe';
  /** Whether the source of unchanged nodes is reused below the top level. */
  reuse: boolean;
  /** Whether no frontmatter precedes the body being written. */
  bareStart: boolean;
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

export interface WriteBodyOptions {
  /**
   * Checks the whole output by reading it back. Without it only the blocks
   * written anew are checked, one by one.
   */
  checkWhole: boolean;
  bareStart: boolean;
}

export class MarkdownWriter {
  private readonly nodeWriters = new Map<string, NodeWriter>();
  private readonly markWriters = new Map<string, MarkToMarkdown>();
  private readonly escapes: EscapeRule[];

  constructor(
    private readonly parser: MarkdownParser,
    notations: readonly NotationDefinition[],
    private readonly parseWhole: (body: string) => ParsedBody = (body) =>
      parser.parseBody(body),
  ) {
    for (const notation of notations) {
      for (const [name, writer] of Object.entries(notation.nodes ?? {})) {
        this.nodeWriters.set(
          name,
          typeof writer === 'function' ? { write: writer } : writer,
        );
      }
      for (const [name, writer] of Object.entries(notation.marks ?? {})) {
        this.markWriters.set(name, writer);
      }
    }
    this.escapes = notations.flatMap((notation) => notation.escapes ?? []);
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
  ): string {
    const attempt = (escaping: WriteState['escaping'], reuse: boolean) =>
      this.writeDocument(doc, reuse ? base : null, {
        styles,
        escaping,
        reuse,
        bareStart: options.bareStart,
      });
    const first = attempt('minimal', true);
    if (!options.checkWhole || this.reads(first, doc, true)) {
      return first;
    }
    // Each block came back the same on its own, so the output only changes
    // meaning in context, e.g. text that a reference definition elsewhere
    // turns into a link.
    const safe = attempt('safe', true);
    if (this.reads(safe, doc, true)) {
      return safe;
    }
    const generated = attempt('safe', false);
    return this.reads(generated, doc, true) ? generated : first;
  }

  private writeDocument(
    doc: ProseMirrorNode,
    base: BaseDocument | null,
    state: WriteState,
  ): string {
    const detachedKept: string[] = [];
    const reusedBlocks = new Set<number>();
    const body = this.sequence(childrenOf(doc), base, {}, state, {
      topLevel: true,
      onReuse: (baseIndex) => reusedBlocks.add(baseIndex),
    });
    for (const [index, text] of base?.detached ?? []) {
      if (!reusedBlocks.has(index)) {
        detachedKept.push(text);
      }
    }
    if (!body && !detachedKept.length) {
      return base && !base.children.some(Boolean) ? base.trailing : '';
    }
    const leading = base?.leading.slice(0, base.leading.lastIndexOf('\n') + 1);
    const detached = detachedKept.length
      ? `${body ? '\n\n' : ''}${detachedKept.join('\n\n')}`
      : '';
    return `${leading ?? ''}${body}${detached}${base?.trailing ?? ''}`;
  }

  /** Whether `markdown` reads back as `doc`, ignoring what is not written. */
  reads(markdown: string, doc: ProseMirrorNode, whole = false): boolean {
    let parsed: ProseMirrorNode;
    try {
      parsed = (
        whole ? this.parseWhole(markdown) : this.parser.parseBody(markdown)
      ).doc;
    } catch {
      return false;
    }
    const written = (node: ProseMirrorNode) =>
      childrenOf(node)
        .filter((child) => !this.isUnwritten(child))
        .map(keyOf);
    const expected = written(doc);
    const actual = written(parsed);
    return (
      expected.length === actual.length &&
      expected.every((key, index) => key === actual[index])
    );
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
    topLevel?: { topLevel: true; onReuse: (baseIndex: number) => void },
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

    const outputs: (string | null)[] = plans.map((plan) =>
      plan.matched &&
      plan.base?.text != null &&
      (topLevel || state.reuse) &&
      (options.reusable?.(plan.base.text, plan.index) ?? true)
        ? plan.base.text
        : null,
    );
    plans.forEach((plan, i) => {
      const previous = plans[i - 1];
      const listMarker = this.nodeWriters.get(plan.node.type.name)?.listMarker;
      const sameList = (other: ChildPlan | undefined) =>
        listMarker && other && other.node.type === plan.node.type;
      const previousMarker =
        sameList(previous) && outputs[i - 1] != null
          ? listMarker?.(outputs[i - 1] as string)
          : undefined;
      let output = outputs[i];
      if (
        output !== null &&
        previousMarker !== undefined &&
        listMarker?.(output) === previousMarker
      ) {
        output = null;
      }
      if (output === null) {
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
          ...(topLevel &&
            i === 0 &&
            state.bareStart && { documentStart: true }),
        };
        output = topLevel
          ? this.writeTopLevel(plan, data, avoid, state)
          : this.generate(plan.node, plan.base, data, avoid, state);
      } else if (topLevel) {
        topLevel.onReuse(plan.baseIndex);
      }
      outputs[i] = output;
    });

    let text = '';
    plans.forEach((plan, i) => {
      if (i > 0) {
        const previous = plans[i - 1];
        const separator =
          previous.base &&
          plan.base &&
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

  private writeTopLevel(
    plan: ChildPlan,
    data: Record<string, unknown>,
    avoid: ReadonlySet<string>,
    state: WriteState,
  ): string {
    const attempts: Pick<WriteState, 'escaping' | 'reuse'>[] =
      state.escaping === 'safe'
        ? [
            { escaping: 'safe', reuse: state.reuse },
            { escaping: 'safe', reuse: false },
          ]
        : [
            { escaping: 'minimal', reuse: state.reuse },
            { escaping: 'safe', reuse: state.reuse },
            { escaping: 'safe', reuse: false },
          ];
    let fallback: string | undefined;
    for (const attempt of attempts) {
      const output = this.generate(plan.node, plan.base, data, avoid, {
        ...state,
        ...attempt,
      });
      if (
        this.reads(
          output,
          plan.node.type.schema.topNodeType.create(null, plan.node),
        )
      ) {
        return output;
      }
      if (attempt.escaping === 'safe') {
        fallback ??= output;
      }
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
      inline: (textblock) => this.inline(textblock, context),
      children: (container, options) =>
        this.sequence(
          childrenOf(container),
          container === node && state.reuse ? (base?.content() ?? null) : null,
          options ?? {},
          state,
        ),
      escape: (text) => this.escapeText(text, false, false),
    };
    const writer = this.nodeWriters.get(node.type.name);
    if (writer) {
      return writer.write(node, context);
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
    const children = childrenOf(textblock);
    const active: Mark[] = [];
    let output = '';

    const closeTo = (depth: number) => {
      while (active.length > depth) {
        const mark = active.pop() as Mark;
        output += this.delimiter(mark, 'close', context);
      }
    };

    const outerMarks = (index: number): readonly Mark[] => {
      const child = children[index];
      if (!child) {
        return [];
      }
      return child.marks.filter((mark) => {
        const writer = this.markWriter(mark);
        if (writer?.run) {
          return false;
        }
        return !(
          context.escaping === 'minimal' &&
          writer?.implied?.(
            {
              node: child,
              previous: children[index - 1],
              next: children[index + 1],
              afterNext: children[index + 2],
            },
            context,
          )
        );
      });
    };

    children.forEach((child, index) => {
      const marks = outerMarks(index);
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
        const text = child.text ?? '';
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
      } else {
        content =
          this.nodeWriters.get(child.type.name)?.write(child, context) ?? '';
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
    return output;
  }
}
