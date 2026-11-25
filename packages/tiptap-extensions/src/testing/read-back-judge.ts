import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Judges whether markdown read back holds a document, independently of the
 * writer's own comparison: both documents are compared exactly, and every
 * difference has to be one of the kinds markdown cannot avoid, which are
 * listed here one by one. The writer shares none of this code, so a mistake
 * in its comparison is not repeated here.
 */
export type AllowedDifference =
  /** Markdown has no empty paragraphs. */
  | 'empty paragraph'
  /** A textblock cannot start or end with a line break. */
  | 'line break at an edge'
  /** Whitespace around a hard break is not kept. */
  | 'whitespace at a hard break'
  /** `*`, `_` and `~` cannot have whitespace just inside them. */
  | 'whitespace at the edge of emphasis'
  /** Raw markdown at the edge of a textblock loses its whitespace there. */
  | 'whitespace at the edge of raw markdown'
  /** GFM links a bare URL, `www.` or email address by itself. */
  | 'autolink'
  /** Raw markdown may read as plain text with the same characters. */
  | 'raw markdown read as text'
  /** A code block's info string is trimmed. */
  | 'trimmed info string'
  /** Markdown has no marks for a line break, e.g. code cannot hold one. */
  | 'marks on a hard break';

const FLANKING_MARKS = new Set(['bold', 'italic', 'strike']);
const RAW_INLINE = 'rawInline';

interface Char {
  value: string;
  marks: string[];
  raw: boolean;
  lineBreak: boolean;
}

/**
 * A paragraph with nothing in it, or only line breaks, which are dropped at
 * the edges of a textblock.
 */
export function isEmptyParagraph(node: ProseMirrorNode): boolean {
  if (node.type.name !== 'paragraph') {
    return false;
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const lineBreak = child.isText
      ? [...(child.text ?? '')].every((char) => char === '\n')
      : Boolean(child.type.spec.linebreakReplacement);
    if (!lineBreak) {
      return false;
    }
  }
  return true;
}

function isAutolinkText(text: string, href: unknown): boolean {
  return (
    typeof href === 'string' &&
    !/\s/.test(text) &&
    ((href === text && /^(?:https?|ftp):\/\//i.test(text)) ||
      (href === `http://${text}` && /^www/i.test(text)) ||
      (href === `mailto:${text}` && /^[^@\s]+@[^@\s]+$/.test(text)))
  );
}

function charsOf(
  textblock: ProseMirrorNode,
  used: Set<AllowedDifference>,
): Char[] {
  const chars: Char[] = [];
  textblock.forEach((child) => {
    const raw = child.marks.some((mark) => mark.type.name === RAW_INLINE);
    const marks = child.marks
      .filter((mark) => mark.type.name !== RAW_INLINE)
      .map((mark) => JSON.stringify(mark.toJSON()))
      .sort();
    if (child.isText) {
      for (const value of child.text ?? '') {
        chars.push({ value, marks: [...marks], raw, lineBreak: false });
      }
    } else if (child.type.spec.linebreakReplacement) {
      if (child.marks.length > 0) {
        used.add('marks on a hard break');
      }
      chars.push({
        value: JSON.stringify(child.mark([]).toJSON()),
        marks: [],
        raw: false,
        lineBreak: true,
      });
    } else {
      // Inline content holds what a textblock's holds, line breaks at its
      // edges too.
      const value = child.inlineContent
        ? {
            type: child.type.name,
            attrs: child.attrs,
            content: normalizeChars(charsOf(child, used), used, false).map(
              ({ value, marks, raw }) => [value, marks, raw],
            ),
          }
        : child.toJSON();
      chars.push({
        value: JSON.stringify(value),
        marks,
        raw,
        lineBreak: false,
      });
    }
  });
  return chars;
}

/** Applies the allowed differences that only remove something. */
function normalizeChars(
  chars: Char[],
  used: Set<AllowedDifference>,
  textblock = true,
): Char[] {
  const result = [...chars];
  const isBreak = (char: Char | undefined) =>
    textblock && Boolean(char && (char.lineBreak || char.value === '\n'));
  const isRawSpace = (char: Char | undefined) =>
    Boolean(char?.raw && /^[ \t]$/.test(char.value));
  for (;;) {
    if (isBreak(result[0]) || isBreak(result.at(-1))) {
      used.add('line break at an edge');
      if (isBreak(result[0])) {
        result.shift();
      } else {
        result.pop();
      }
    } else if (isRawSpace(result[0]) || isRawSpace(result.at(-1))) {
      used.add('whitespace at the edge of raw markdown');
      if (isRawSpace(result[0])) {
        result.shift();
      } else {
        result.pop();
      }
    } else {
      break;
    }
  }
  for (let i = result.length - 1; i >= 0; i--) {
    if (!result[i].lineBreak) {
      continue;
    }
    const space = (char: Char | undefined) =>
      Boolean(char && /^[ \t]$/.test(char.value));
    while (space(result[i + 1])) {
      used.add('whitespace at a hard break');
      result.splice(i + 1, 1);
    }
    while (space(result[i - 1])) {
      used.add('whitespace at a hard break');
      result.splice(i - 1, 1);
      i--;
    }
  }
  for (let i = 0; i < result.length; i++) {
    const char = result[i];
    if (!/^\s$/.test(char.value) || char.raw) {
      continue;
    }
    for (const mark of [...char.marks]) {
      if (!FLANKING_MARKS.has(JSON.parse(mark).type)) {
        continue;
      }
      // Whitespace at the edge of the mark's range, looking past other
      // whitespace under the same mark.
      let before = i - 1;
      while (
        before >= 0 &&
        /^\s$/.test(result[before].value) &&
        result[before].marks.includes(mark)
      ) {
        before--;
      }
      let after = i + 1;
      while (
        after < result.length &&
        /^\s$/.test(result[after].value) &&
        result[after].marks.includes(mark)
      ) {
        after++;
      }
      const startsRange = before < 0 || !result[before].marks.includes(mark);
      const endsRange =
        after >= result.length || !result[after].marks.includes(mark);
      if (startsRange || endsRange) {
        used.add('whitespace at the edge of emphasis');
        result[i] = {
          ...result[i],
          marks: result[i].marks.filter((it) => it !== mark),
        };
      }
    }
  }
  return result;
}

function compareTextblocks(
  expected: ProseMirrorNode,
  actual: ProseMirrorNode,
  path: string,
  used: Set<AllowedDifference>,
  unexplained: string[],
): void {
  const a = normalizeChars(charsOf(expected, used), used);
  const b = normalizeChars(charsOf(actual, used), used);
  // Links GFM made by itself, by the text they cover.
  const autolinks = new Set<number>();
  let i = 0;
  while (i < b.length) {
    const link = b[i].marks.find((mark) => JSON.parse(mark).type === 'link');
    if (!link) {
      i++;
      continue;
    }
    let j = i;
    while (j < b.length && b[j].marks.includes(link)) {
      j++;
    }
    const text = b
      .slice(i, j)
      .map((char) => char.value)
      .join('');
    if (isAutolinkText(text, JSON.parse(link).attrs?.href)) {
      for (let k = i; k < j; k++) {
        autolinks.add(k);
      }
    }
    i = j;
  }
  if (a.length !== b.length) {
    unexplained.push(
      `${path}: ${JSON.stringify(a.map((c) => c.value).join(''))} read back as ${JSON.stringify(b.map((c) => c.value).join(''))}`,
    );
    return;
  }
  for (let k = 0; k < a.length; k++) {
    const want = a[k];
    const got = b[k];
    if (want.value !== got.value) {
      unexplained.push(
        `${path}: character ${k} ${JSON.stringify(want.value)} read back as ${JSON.stringify(got.value)}`,
      );
      return;
    }
    if (want.raw !== got.raw) {
      if (want.raw) {
        used.add('raw markdown read as text');
      } else {
        unexplained.push(`${path}: text at ${k} read back as raw markdown`);
        return;
      }
    }
    const wantMarks = JSON.stringify(want.marks);
    if (wantMarks !== JSON.stringify(got.marks)) {
      const withoutLink = got.marks.filter(
        (mark) => JSON.parse(mark).type !== 'link',
      );
      if (
        autolinks.has(k) &&
        !want.marks.some((mark) => JSON.parse(mark).type === 'link') &&
        JSON.stringify(withoutLink) === wantMarks
      ) {
        used.add('autolink');
      } else {
        unexplained.push(
          `${path}: marks at ${k} (${JSON.stringify(want.value)}) ${wantMarks} read back as ${JSON.stringify(got.marks)}`,
        );
        return;
      }
    }
  }
}

function attrsOf(node: ProseMirrorNode, used: Set<AllowedDifference>) {
  if (node.type.name !== 'codeBlock') {
    return JSON.stringify(node.attrs);
  }
  const language =
    typeof node.attrs.language === 'string'
      ? node.attrs.language.replace(/\n/g, ' ').trim() || null
      : null;
  if (language !== node.attrs.language) {
    used.add('trimmed info string');
  }
  return JSON.stringify({ ...node.attrs, language });
}

function compareNodes(
  expected: ProseMirrorNode,
  actual: ProseMirrorNode,
  path: string,
  used: Set<AllowedDifference>,
  unexplained: string[],
): void {
  if (
    expected.type !== actual.type ||
    attrsOf(expected, used) !== attrsOf(actual, used)
  ) {
    unexplained.push(
      `${path}: ${expected.type.name} ${JSON.stringify(expected.attrs)} read back as ${actual.type.name} ${JSON.stringify(actual.attrs)}`,
    );
    return;
  }
  if (expected.isTextblock) {
    compareTextblocks(expected, actual, path, used, unexplained);
    return;
  }
  const childrenOf = (node: ProseMirrorNode) => {
    const all: ProseMirrorNode[] = [];
    node.forEach((child) => {
      all.push(child);
    });
    const kept = all.filter((child) => !isEmptyParagraph(child));
    if (kept.length === all.length) {
      return all;
    }
    used.add('empty paragraph');
    if (node.type.validContent(Fragment.from(kept))) {
      return kept;
    }
    // The first one stays where the container requires it.
    const first = [all[0], ...kept.filter((child) => child !== all[0])];
    return node.type.validContent(Fragment.from(first)) ? first : all;
  };
  const a = childrenOf(expected);
  const b = childrenOf(actual);
  if (a.length !== b.length) {
    unexplained.push(
      `${path}: ${a.length} children read back as ${b.length}: ${String(expected)} / ${String(actual)}`,
    );
    return;
  }
  a.forEach((child, index) => {
    compareNodes(child, b[index], `${path}/${index}`, used, unexplained);
  });
}

export interface Judgement {
  /** Differences none of the allowed kinds explain. */
  unexplained: string[];
  used: Set<AllowedDifference>;
}

/**
 * Compares a document with the one read back from its markdown. Raw
 * markdown that does not read back as the same characters, e.g. raw text
 * edited into syntax, is left unexplained: `rawMeaning` can explain a block
 * that holds it, by reading it as markdown.
 */
export function judgeReadBack(
  expected: ProseMirrorNode,
  actual: ProseMirrorNode,
  rawMeaning?: (block: ProseMirrorNode) => ProseMirrorNode[] | null,
): Judgement {
  const used = new Set<AllowedDifference>();
  const unexplained: string[] = [];
  const blocks = (doc: ProseMirrorNode) => {
    const children: ProseMirrorNode[] = [];
    doc.forEach((child) => {
      if (isEmptyParagraph(child)) {
        used.add('empty paragraph');
      } else {
        children.push(child);
      }
    });
    return children;
  };
  const a = blocks(expected);
  const b = blocks(actual);
  let j = 0;
  a.forEach((block, index) => {
    const direct: string[] = [];
    if (j < b.length) {
      compareNodes(block, b[j], `${index}`, used, direct);
    }
    if (j < b.length && direct.length === 0) {
      j++;
      return;
    }
    const meaning = rawMeaning?.(block);
    if (meaning) {
      const alternative: string[] = [];
      meaning.forEach((it, k) => {
        if (b[j + k]) {
          compareNodes(it, b[j + k], `${index}~${k}`, used, alternative);
        } else {
          alternative.push(`${index}~${k}: missing`);
        }
      });
      if (alternative.length === 0) {
        j += meaning.length;
        return;
      }
    }
    unexplained.push(...(direct.length ? direct : [`${index}: missing`]));
    j++;
  });
  if (j < b.length) {
    unexplained.push(`${b.length - j} extra blocks read back`);
  }
  return { unexplained, used };
}

const TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  strike: 'del',
};

/** A text node as markdown, written here without the editor's writer. */
function writeText(child: ProseMirrorNode): string | null {
  const raw = child.marks.some((mark) => mark.type.name === RAW_INLINE);
  const text = child.text ?? '';
  let markdown = raw ? text : text.replace(/[!-/:-@[-`{-~]/g, '\\$&');
  for (const mark of child.marks) {
    const name = mark.type.name;
    if (name === RAW_INLINE) {
      continue;
    }
    if (name === 'code') {
      const fence = '`'.repeat(
        Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1,
      );
      markdown = `${fence} ${text} ${fence}`;
    } else if (TAGS[name]) {
      markdown = `<${TAGS[name]}>${markdown}</${TAGS[name]}>`;
    } else if (name === 'link') {
      markdown = `[${markdown}](<${String(mark.attrs.href ?? '').replace(/[\\<>]/g, '\\$&')}>)`;
    } else {
      return null;
    }
  }
  return markdown;
}

/**
 * What a block with raw markdown means: its raw markdown as written, and
 * its other text with every ASCII punctuation character escaped and its
 * marks as tags. Only paragraphs and raw blocks are read so; others are
 * left to `null`.
 */
export function rawMeaningOf(
  read: (markdown: string) => ProseMirrorNode,
): (block: ProseMirrorNode) => ProseMirrorNode[] | null {
  return (block) => {
    if (block.type.name === 'rawBlock') {
      return childrenOfDoc(read(block.textContent));
    }
    if (!block.isTextblock || block.type.name !== 'paragraph') {
      return null;
    }
    let markdown = '';
    let readable = true;
    let raw = false;
    block.forEach((child) => {
      raw ||= child.marks.some((mark) => mark.type.name === RAW_INLINE);
      const written = child.isText
        ? writeText(child)
        : child.type.spec.linebreakReplacement
          ? '<br>'
          : null;
      if (written === null) {
        readable = false;
      } else {
        markdown += written;
      }
    });
    return readable && raw ? childrenOfDoc(read(markdown.trim())) : null;
  };
}

function childrenOfDoc(doc: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  doc.forEach((child) => {
    children.push(child);
  });
  return children;
}
