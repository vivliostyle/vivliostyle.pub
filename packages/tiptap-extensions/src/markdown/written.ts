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
  /** The markdown of a textblock's content. */
  writeInline?: (node: ProseMirrorNode) => string;
}

/**
 * Reduces documents to what their markdown holds, so a document and the one
 * read back from its markdown can be compared: empty paragraphs, line breaks
 * at the ends of a textblock and whitespace at the edges of emphasis have no
 * markdown, and raw markdown means whatever it reads as.
 */
export class WrittenForm {
  constructor(private readonly options: WrittenFormOptions) {}

  blocks(doc: ProseMirrorNode, expandRaw: boolean): WrittenBlock[] {
    const blocks: WrittenBlock[] = [];
    let origin = 0;
    doc.forEach((child) => {
      if (this.options.isUnwritten(child)) {
        return;
      }
      for (const node of expandRaw ? this.expand(child) : [child]) {
        blocks.push({ node: this.form(node, expandRaw), origin });
      }
      origin++;
    });
    return blocks;
  }

  // A raw block, a textblock holding nothing but raw markdown, or one that
  // starts with raw markdown of block syntax means what its text reads as,
  // which can be other blocks once it was edited.
  private expand(node: ProseMirrorNode): ProseMirrorNode[] {
    const { rawBlockName, readRaw, rawInline, writeInline } = this.options;
    if (!readRaw) {
      return [node];
    }
    const isRaw = (child: ProseMirrorNode | null) =>
      Boolean(child?.isText && rawInline?.isInSet(child.marks));
    let text: string | undefined;
    if (node.type.name === rawBlockName) {
      text = node.textContent;
    } else if (
      node.isTextblock &&
      node.childCount > 0 &&
      isRaw(node.firstChild)
    ) {
      if (node.content.content.every(isRaw)) {
        text = node.textContent;
      } else if (writeInline) {
        const start = readRaw(node.firstChild?.text ?? '');
        if (start && !(start.length === 1 && start[0].type === node.type)) {
          text = writeInline(node);
        }
      }
    }
    if (text === undefined) {
      return [node];
    }
    const read = readRaw(text);
    if (
      !read ||
      read.length === 0 ||
      (read.length === 1 && read[0].type === node.type)
    ) {
      return [node];
    }
    return read;
  }

  private form(node: ProseMirrorNode, expandRaw: boolean): WrittenNode {
    const attrs = JSON.stringify(this.options.attrsOf?.(node) ?? node.attrs);
    if (node.isTextblock) {
      return { type: node.type.name, attrs, runs: this.runs(node) };
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
    const kept = node.type.validContent(Fragment.from(written))
      ? written
      : children;
    let expanded = kept.flatMap((child) =>
      expandRaw ? this.expand(child) : [child],
    );
    if (expanded !== kept && !node.type.validContent(Fragment.from(expanded))) {
      // Raw markdown that now reads as other blocks still gets what the
      // container requires before it, as reading does, e.g. a list item's
      // first paragraph.
      const before = node.type.contentMatch.fillBefore(Fragment.from(expanded));
      if (before) {
        expanded = [...before.content, ...expanded];
      }
    }
    return {
      type: node.type.name,
      attrs,
      children: expanded.map((it) => this.form(it, expandRaw)),
    };
  }

  private runs(textblock: ProseMirrorNode): Run[] {
    const { rawInline } = this.options;
    const chars: Char[] = [];
    textblock.forEach((child) => {
      const raw = Boolean(rawInline?.isInSet(child.marks));
      const marks = child.marks
        .filter((mark) => mark.type !== rawInline)
        .map((mark) => JSON.stringify(mark.toJSON()));
      if (!child.isText) {
        chars.push({
          atom: JSON.stringify(child.toJSON()),
          lineBreak: child.type.spec.linebreakReplacement === true,
          marks,
          raw,
        });
        return;
      }
      for (const char of child.text ?? '') {
        chars.push({ char, marks: [...marks], raw });
      }
    });
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
        last.raw === char.raw
      ) {
        last.text += char.char;
      } else {
        runs.push({ text: char.char, marks, raw: char.raw });
      }
    }
    return runs;
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

function runsMatch(expected: readonly Run[], actual: readonly Run[]): boolean {
  const expectsRaw = expected.some((run) => run.raw);
  if (!expectsRaw) {
    return (
      expected.length === actual.length &&
      expected.every(
        (run, index) =>
          !actual[index].raw &&
          run.text === actual[index].text &&
          run.atom === actual[index].atom &&
          run.marks === actual[index].marks,
      )
    );
  }
  // Raw markdown reads as whatever it reads as, but the text around it has
  // to come back as it was, in order, as text and with its marks.
  let index = 0;
  let offset = 0;
  for (const run of expected) {
    if (run.raw) {
      continue;
    }
    let found = false;
    while (!found && index < actual.length) {
      const candidate = actual[index];
      if (!candidate.raw && candidate.marks === run.marks) {
        if (run.atom !== undefined && candidate.atom === run.atom) {
          index++;
          offset = 0;
          found = true;
          continue;
        }
        const at =
          run.text !== undefined && candidate.text !== undefined
            ? candidate.text.indexOf(run.text, offset)
            : -1;
        if (at !== -1) {
          offset = at + (run.text?.length ?? 0);
          found = true;
          continue;
        }
      }
      index++;
      offset = 0;
    }
    if (!found) {
      return false;
    }
  }
  return true;
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

/** The index of the first block of `doc` that `read` does not hold, or -1. */
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
