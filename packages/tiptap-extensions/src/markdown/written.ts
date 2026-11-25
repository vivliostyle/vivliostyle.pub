import {
  Fragment,
  type MarkType,
  type Node as ProseMirrorNode,
} from '@tiptap/pm/model';

interface Run {
  text?: string;
  atom?: string;
  marks: string;
  raw: boolean;
  /**
   * The link mark, among `marks`, that GFM would have made of the text by
   * itself: a URL, `www.` or an email address written bare.
   */
  autolink?: string;
}

/** A node as markdown can hold it. */
export interface WrittenNode {
  type: string;
  attrs: string;
  runs?: Run[];
  children?: WrittenNode[];
}

/** One top-level block as markdown can hold it. */
export interface WrittenBlock {
  node: WrittenNode;
  /** The index of the document's block it comes from. */
  origin: number;
}

interface Char {
  char?: string;
  atom?: string;
  lineBreak?: boolean;
  marks: string[];
  raw: boolean;
  autolink?: string;
}

export interface WrittenFormOptions {
  rawInline: MarkType | undefined;
  rawBlockName: string;
  isUnwritten: (node: ProseMirrorNode) => boolean;
  /** Marks whose delimiters push whitespace at their edges outside. */
  flanking: ReadonlySet<string>;
  /**
   * What a raw block's text reads as on its own, when that is not the raw
   * block itself, i.e. the text was edited into other markdown.
   */
  readRaw?: (text: string) => ProseMirrorNode[] | null;
  /** The attributes as the markdown holds them, see `NodeWriter`. */
  attrsOf?: (node: ProseMirrorNode) => Record<string, unknown>;
  /** See `NodeWriter.writtenAs`. */
  writtenAs?: (
    node: ProseMirrorNode,
  ) => { type: string; attrs: Record<string, unknown> } | null;
  /**
   * A top-level block as markdown with every character that could mean
   * something escaped, so that only its raw markdown means anything.
   */
  writeSafe?: (node: ProseMirrorNode) => string;
}

/** The text GFM autolinks to `href` when written bare, see `isBareUrlLink`. */
function isAutolinkLiteral(text: string, href: unknown): boolean {
  if (typeof href !== 'string' || /\s/.test(text)) {
    return false;
  }
  return (
    (href === text && /^(?:https?|ftp):\/\//i.test(text)) ||
    (href === `http://${text}` && /^www/i.test(text)) ||
    (href === `mailto:${text}` && /^[^@]+@[^@]+$/.test(text))
  );
}

/**
 * Reduces documents to what their markdown holds, so a document and the one
 * read back from its markdown can be compared: empty paragraphs, line breaks
 * at the ends of a textblock and whitespace at the edges of emphasis have no
 * markdown.
 *
 * Raw markdown reads back as the same text, as long as it is not edited
 * into other syntax. Where a block with raw markdown does not read back the
 * same, it means what it reads as once every character but the raw markdown
 * is escaped, which can be other blocks.
 */
export class WrittenForm {
  constructor(private readonly options: WrittenFormOptions) {}

  blocks(doc: ProseMirrorNode, read: boolean): WrittenBlock[] {
    const blocks: WrittenBlock[] = [];
    let origin = 0;
    doc.forEach((child) => {
      if (this.options.isUnwritten(child)) {
        return;
      }
      blocks.push({ node: this.form(child, read), origin });
      origin++;
    });
    return blocks;
  }

  /**
   * Whether `actual`, read back from markdown, holds the top-level block
   * `node` of a document.
   */
  holds(node: ProseMirrorNode, actual: readonly ProseMirrorNode[]): boolean {
    const got = actual.filter((child) => !this.options.isUnwritten(child));
    return this.consume(node, got, 0) === got.length;
  }

  /**
   * How many of the blocks read back from `start` on hold the top-level
   * block `node` of a document, or -1 when they do not.
   */
  consume(
    node: ProseMirrorNode,
    actual: readonly ProseMirrorNode[],
    start: number,
  ): number {
    const same = (want: readonly WrittenNode[]) =>
      start + want.length <= actual.length &&
      want.every((it, i) => nodesMatch(it, this.form(actual[start + i], true)));
    if (same([this.form(node, false)])) {
      return 1;
    }
    const meaning = this.rawMeaning(node);
    return meaning !== null && same(meaning) ? meaning.length : -1;
  }

  /** What a block with raw markdown means, see the class. */
  private rawMeaning(node: ProseMirrorNode): WrittenNode[] | null {
    const { readRaw, writeSafe, rawInline, rawBlockName } = this.options;
    if (!readRaw || !writeSafe) {
      return null;
    }
    let raw = node.type.name === rawBlockName;
    node.descendants((child) => {
      raw ||=
        child.type.name === rawBlockName ||
        Boolean(child.isText && rawInline?.isInSet(child.marks));
      return !raw;
    });
    if (!raw) {
      return null;
    }
    const read = readRaw(writeSafe(node));
    return (
      read
        ?.filter((child) => !this.options.isUnwritten(child))
        .map((child) => this.form(child, true)) ?? null
    );
  }

  private form(node: ProseMirrorNode, read: boolean): WrittenNode {
    const as = this.options.writtenAs?.(node);
    if (as) {
      return { type: as.type, attrs: JSON.stringify(as.attrs) };
    }
    const attrs = JSON.stringify(this.options.attrsOf?.(node) ?? node.attrs);
    if (node.isTextblock) {
      return { type: node.type.name, attrs, runs: this.runs(node, read) };
    }
    if (node.isLeaf) {
      return { type: node.type.name, attrs };
    }
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => {
      children.push(child);
    });
    const written = children.filter(
      (child) => !this.options.isUnwritten(child),
    );
    // Markdown keeps an empty paragraph only where the container needs one,
    // such as the first in a list item.
    const required = children[0] && [
      children[0],
      ...written.filter((child) => child !== children[0]),
    ];
    const kept = node.type.validContent(Fragment.from(written))
      ? written
      : required && node.type.validContent(Fragment.from(required))
        ? required
        : children;
    return {
      type: node.type.name,
      attrs,
      children: kept.map((it) => this.form(it, read)),
    };
  }

  private runs(textblock: ProseMirrorNode, read: boolean): Run[] {
    const { rawInline } = this.options;
    const chars: Char[] = [];
    textblock.forEach((child) => {
      const raw = Boolean(rawInline?.isInSet(child.marks));
      const marks = child.marks
        .filter((mark) => mark.type !== rawInline)
        .map((mark) => JSON.stringify(mark.toJSON()));
      if (!child.isText) {
        const lineBreak = child.type.spec.linebreakReplacement === true;
        // Inline content, like a textblock's, holds what its markdown holds.
        const content = child.inlineContent
          ? {
              type: child.type.name,
              attrs: this.options.attrsOf?.(child) ?? child.attrs,
              runs: this.runs(child, read),
            }
          : null;
        // Markdown has no marks for a line break, e.g. code cannot hold one.
        chars.push({
          atom: JSON.stringify(
            content ?? (lineBreak ? child.mark([]).toJSON() : child.toJSON()),
          ),
          lineBreak,
          marks: lineBreak ? [] : marks,
          raw: lineBreak ? false : raw,
        });
        return;
      }
      for (const char of child.text ?? '') {
        chars.push({ char, marks: [...marks], raw });
      }
    });
    if (read) {
      this.findAutolinks(textblock, chars);
    }
    const isBreak = (it: Char | undefined) =>
      it?.char === '\n' || Boolean(it?.lineBreak);
    // Raw markdown at the edges of a textblock may start or end with
    // whitespace, which markdown does not keep there.
    const isEdgeSpace = (it: Char | undefined) =>
      Boolean(it?.raw && it.char && /[ \t]/.test(it.char));
    while (isBreak(chars[0]) || isEdgeSpace(chars[0])) {
      chars.shift();
    }
    while (isBreak(chars.at(-1)) || isEdgeSpace(chars.at(-1))) {
      chars.pop();
    }
    // Markdown keeps no whitespace around a hard line break.
    for (let i = chars.length - 1; i >= 0; i--) {
      if (!chars[i].lineBreak) {
        continue;
      }
      let end = i + 1;
      while (end < chars.length && /^[ \t]$/.test(chars[end].char ?? '')) {
        end++;
      }
      chars.splice(i + 1, end - i - 1);
      let start = i;
      while (start > 0 && /^[ \t]$/.test(chars[start - 1].char ?? '')) {
        start--;
      }
      chars.splice(start, i - start);
    }
    this.expelWhitespace(chars);
    const runs: Run[] = [];
    for (const char of chars) {
      const marks = JSON.stringify(char.marks);
      const last = runs.at(-1);
      if (char.atom !== undefined) {
        runs.push({ atom: char.atom, marks, raw: char.raw });
      } else if (
        last?.text !== undefined &&
        last.marks === marks &&
        last.raw === char.raw &&
        last.autolink === char.autolink
      ) {
        last.text += char.char;
      } else {
        runs.push({
          text: char.char,
          marks,
          raw: char.raw,
          ...(char.autolink && { autolink: char.autolink }),
        });
      }
    }
    return runs;
  }

  /** Flags the characters of links that GFM made of bare text. */
  private findAutolinks(textblock: ProseMirrorNode, chars: Char[]): void {
    let offset = 0;
    const spans: { from: number; to: number; key: string; text: string }[] = [];
    textblock.forEach((child) => {
      const link = child.marks.find((mark) => mark.type.name === 'link');
      const size = child.isText ? [...(child.text ?? '')].length : 1;
      if (child.isText && link) {
        const key = JSON.stringify(link.toJSON());
        const last = spans.at(-1);
        if (last && last.key === key && last.to === offset) {
          last.to += size;
          last.text += child.text ?? '';
        } else {
          spans.push({
            from: offset,
            to: offset + size,
            key,
            text: child.text ?? '',
          });
        }
      }
      offset += size;
    });
    for (const span of spans) {
      const href = (JSON.parse(span.key) as { attrs?: { href?: unknown } })
        .attrs?.href;
      if (!isAutolinkLiteral(span.text, href)) {
        continue;
      }
      for (let i = span.from; i < span.to && i < chars.length; i++) {
        chars[i].autolink = span.key;
      }
    }
  }

  // Whitespace at the edges of a flanking mark's range is written outside
  // its delimiters.
  private expelWhitespace(chars: Char[]): void {
    const { flanking } = this.options;
    const keys = new Set(
      chars.flatMap((char) =>
        char.marks.filter((mark) => flanking.has(JSON.parse(mark).type)),
      ),
    );
    const isSpace = (char: Char) =>
      !char.raw && char.char !== undefined && /\s/.test(char.char);
    for (const key of keys) {
      let start = 0;
      while (start < chars.length) {
        if (!chars[start].marks.includes(key)) {
          start++;
          continue;
        }
        let end = start;
        while (end < chars.length && chars[end].marks.includes(key)) {
          end++;
        }
        let from = start;
        while (from < end && isSpace(chars[from])) {
          chars[from].marks = chars[from].marks.filter((it) => it !== key);
          from++;
        }
        let to = end - 1;
        while (to >= from && isSpace(chars[to])) {
          chars[to].marks = chars[to].marks.filter((it) => it !== key);
          to--;
        }
        start = end;
      }
    }
  }
}

interface FlatChar {
  value: string;
  marks: string;
  raw: boolean;
  autolink?: string;
}

function flatten(runs: readonly Run[]): FlatChar[] {
  return runs.flatMap((run) =>
    run.atom !== undefined
      ? [{ value: `\u0000${run.atom}`, marks: run.marks, raw: run.raw }]
      : [...(run.text ?? '')].map((value) => ({
          value,
          marks: run.marks,
          raw: run.raw,
          ...(run.autolink && { autolink: run.autolink }),
        })),
  );
}

function withoutMark(marks: string, mark: string): string {
  return JSON.stringify(
    (JSON.parse(marks) as string[]).filter((it) => it !== mark),
  );
}

/**
 * Raw markdown reads back as the same text, as raw markdown again or as
 * plain text; other text reads back as text with the same marks, or with a
 * link GFM made of a bare URL in it.
 */
function runsMatch(expected: readonly Run[], actual: readonly Run[]): boolean {
  const a = flatten(expected);
  const b = flatten(actual);
  return (
    a.length === b.length &&
    a.every((char, index) => {
      const other = b[index];
      if (char.value !== other.value || (other.raw && !char.raw)) {
        return false;
      }
      return (
        char.marks === other.marks ||
        (other.autolink !== undefined &&
          withoutMark(other.marks, other.autolink) === char.marks)
      );
    })
  );
}

function nodesMatch(expected: WrittenNode, actual: WrittenNode): boolean {
  if (expected.type !== actual.type || expected.attrs !== actual.attrs) {
    return false;
  }
  if (expected.runs || actual.runs) {
    return runsMatch(expected.runs ?? [], actual.runs ?? []);
  }
  const a = expected.children ?? [];
  const b = actual.children ?? [];
  return (
    a.length === b.length && a.every((child, i) => nodesMatch(child, b[i]))
  );
}

/**
 * The index of the first block of `doc` that `read` does not hold, or -1,
 * comparing block by block.
 */
export function firstDifference(
  doc: readonly WrittenBlock[],
  read: readonly WrittenBlock[],
): number {
  const length = Math.max(doc.length, read.length);
  for (let index = 0; index < length; index++) {
    const expected = doc[index];
    const actual = read[index];
    if (!expected || !actual || !nodesMatch(expected.node, actual.node)) {
      return (expected ?? doc.at(-1))?.origin ?? 0;
    }
  }
  return -1;
}
