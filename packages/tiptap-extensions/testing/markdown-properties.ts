import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

import {
  getMarkdownWithResult,
  markdownPipeline,
  parseMarkdown,
} from '../src/markdown/extension';
import { splitSource } from '../src/markdown/source';
import { MarkdownWriteError } from '../src/markdown/write';
import {
  isEmptyParagraph,
  judgeReadBack,
  rawMeaningOf,
} from './read-back-judge';

/** A way the markdown conversion breaks one of its guarantees. */
export interface PropertyViolation {
  property:
    | 'identity'
    | 'locality'
    | 'round trip'
    | 'judge'
    | 'regeneration'
    | 'error';
  detail: string;
  actual: string;
  expected: string;
}

const LIST_TYPES = new Set(['bulletList', 'orderedList']);

/** Whether `markdown` reads back as `doc`, as the writer checks it. */
export function readsBackAs(
  editor: Editor,
  markdown: string,
  doc: ProseMirrorNode,
): boolean {
  const { writer } = markdownPipeline(editor);
  return writer.difference(parseMarkdown(editor, markdown).doc, doc) === -1;
}

function holdsRaw(node: ProseMirrorNode): boolean {
  let raw = node.type.name === 'rawBlock';
  node.descendants((child) => {
    raw ||=
      child.type.name === 'rawBlock' ||
      child.marks.some((mark) => mark.type.name === 'rawInline');
    return !raw;
  });
  return raw;
}

/**
 * Where `markdown` does not read back as `doc`, judged without the writer's
 * comparison, see `judgeReadBack`. A block whose raw markdown was edited
 * into other syntax means what the writer's markdown of it reads as, which
 * the judge cannot tell, so there the writer's comparison decides.
 */
export function unexplainedDifferences(
  editor: Editor,
  markdown: string,
  doc: ProseMirrorNode,
): string[] {
  const read = (text: string) => parseMarkdown(editor, text).doc;
  const { unexplained } = judgeReadBack(
    doc,
    read(markdown),
    rawMeaningOf(read),
  );
  if (unexplained.length === 0 || !readsBackAs(editor, markdown, doc)) {
    return unexplained;
  }
  const blocks: ProseMirrorNode[] = [];
  doc.forEach((child) => {
    if (!isEmptyParagraph(child)) {
      blocks.push(child);
    }
  });
  const indexOf = (entry: string) => Number(entry.match(/^\d+/)?.[0] ?? -1);
  const deferred = unexplained
    .map(indexOf)
    .find((index) => blocks[index] && holdsRaw(blocks[index]));
  // The blocks after one read as other blocks can no longer be paired.
  return deferred === undefined
    ? unexplained
    : unexplained.filter((entry) => indexOf(entry) < deferred);
}

/**
 * Whether `output` is `baseline` with text inserted between `start` and
 * `end` and nothing removed: what was not edited stays byte for byte.
 */
function insertsOnly(
  baseline: string,
  output: string,
  start: number,
  end: number,
): boolean {
  let prefix = 0;
  while (
    prefix < baseline.length &&
    prefix < output.length &&
    baseline[prefix] === output[prefix]
  ) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < baseline.length - prefix &&
    suffix < output.length - prefix &&
    baseline[baseline.length - 1 - suffix] ===
      output[output.length - 1 - suffix]
  ) {
    suffix++;
  }
  return (
    prefix + suffix === baseline.length && prefix >= start && prefix <= end
  );
}

interface Block {
  index: number;
  start: number;
  end: number;
  offset: number;
  node: ProseMirrorNode;
}

function blocksOf(editor: Editor, markdown: string): Block[] {
  const { frontmatter, body } = splitSource(markdown);
  const parsed = markdownPipeline(editor).parseBody(body);
  const blocks: Block[] = [];
  editor.state.doc.forEach((node, offset, index) => {
    const range = parsed.ranges.get(parsed.doc.child(index));
    if (range) {
      blocks.push({
        index,
        start: frontmatter.length + range.start,
        end: frontmatter.length + range.end,
        offset,
        node,
      });
    }
  });
  return blocks;
}

/** Positions of the textblocks in a top-level block, outermost first. */
function textblocksIn(block: Block): { pos: number; node: ProseMirrorNode }[] {
  const found: { pos: number; node: ProseMirrorNode }[] = [];
  block.node.descendants((node, pos) => {
    if (node.isTextblock && !node.type.spec.code) {
      found.push({ pos: block.offset + 1 + pos, node });
      return false;
    }
    return true;
  });
  return found;
}

type Edit = [
  string,
  (tr: Transaction) => void,
  'append' | 'edit' | 'delete' | 'insert',
];

function editsOf(editor: Editor, block: Block): Edit[] {
  const { schema } = editor.state;
  const edits: Edit[] = [];
  const textblocks = textblocksIn(block);
  const first = textblocks[0];
  const last = textblocks.at(-1);
  const end = (it: { pos: number; node: ProseMirrorNode }) =>
    it.pos + it.node.nodeSize - 1;
  if (first && first.node.content.size > 0) {
    edits.push([
      'appending to',
      (tr) => tr.insertText('X', end(first)),
      'edit',
    ]);
    // Text without the marks before it only adds to the source.
    edits.push([
      'appending plain text to',
      (tr) => tr.insert(end(first), schema.text('X')),
      'append',
    ]);
    edits.push([
      'deleting the first character of',
      (tr) => tr.delete(first.pos + 1, first.pos + 2),
      'edit',
    ]);
    edits.push([
      'emptying the first textblock of',
      (tr) => tr.delete(first.pos + 1, end(first)),
      'edit',
    ]);
  }
  if (last && last !== first && last.node.content.size > 0) {
    edits.push([
      'appending to the last textblock of',
      (tr) => tr.insert(end(last), schema.text('X')),
      'append',
    ]);
  }
  const { heading, paragraph } = schema.nodes;
  if (block.node.type === paragraph && heading) {
    edits.push([
      'making a heading of',
      (tr) => tr.setNodeMarkup(block.offset, heading, { level: 2 }),
      'edit',
    ]);
  } else if (block.node.type === heading && paragraph) {
    edits.push([
      'making a paragraph of',
      (tr) => tr.setNodeMarkup(block.offset, paragraph),
      'edit',
    ]);
  }
  if (LIST_TYPES.has(block.node.type.name) && block.node.childCount > 1) {
    const item = block.node.child(0);
    edits.push([
      'deleting the first item of',
      (tr) => tr.delete(block.offset + 1, block.offset + 1 + item.nodeSize),
      'edit',
    ]);
  }
  edits.push([
    'deleting',
    (tr) => tr.delete(block.offset, block.offset + block.node.nodeSize),
    'delete',
  ]);
  if (paragraph) {
    edits.push([
      'inserting a paragraph after',
      (tr) =>
        tr.insert(
          block.offset + block.node.nodeSize,
          paragraph.create(null, schema.text('新しい段落')),
        ),
      'insert',
    ]);
  }
  return edits;
}

function lineStart(text: string, index: number): number {
  return text.lastIndexOf('\n', index - 1) + 1;
}

function lineEnd(text: string, index: number): number {
  const end = text.indexOf('\n', index);
  return end === -1 ? text.length : end;
}

function write(
  editor: Editor,
  doc: ProseMirrorNode,
): { markdown: string; strategy: string } | { error: MarkdownWriteError } {
  try {
    return getMarkdownWithResult(editor, { doc });
  } catch (error) {
    if (error instanceof MarkdownWriteError) {
      return { error };
    }
    throw error;
  }
}

/**
 * Loads `markdown` and checks that saving it gives it back byte for byte,
 * that editing, deleting or adding next to one top-level block changes only
 * that block's lines, that whatever is written reads back as the same
 * document, and that no save gives up on the baseline.
 */
export function checkMarkdownProperties(
  createEditor: () => Editor,
  markdown: string,
): PropertyViolation[] {
  const violations: PropertyViolation[] = [];
  const editor = createEditor();
  try {
    editor.commands.setMarkdown(markdown, { emitUpdate: false });
    const original = editor.state.doc;

    const saved = write(editor, original);
    if ('error' in saved || saved.markdown !== markdown) {
      violations.push({
        property: 'identity',
        detail: 'saving the unedited document',
        actual: 'error' in saved ? String(saved.error) : saved.markdown,
        expected: markdown,
      });
    }

    const generated = getMarkdownWithResult(editor, { baseline: '' });
    if (!readsBackAs(editor, generated.markdown, original)) {
      violations.push({
        property: 'round trip',
        detail: 'writing the document without a baseline',
        actual: String(parseMarkdown(editor, generated.markdown).doc),
        expected: String(original),
      });
    }

    const blocks = blocksOf(editor, markdown);
    for (const [position, block] of blocks.entries()) {
      for (const [name, apply, kind] of editsOf(editor, block)) {
        const detail = `${name} block ${block.index}`;
        const tr = editor.state.tr;
        apply(tr);
        const { doc } = tr;
        const result = write(editor, doc);
        if ('error' in result) {
          violations.push({
            property: 'error',
            detail,
            actual: result.error.markdown,
            expected: String(doc),
          });
          continue;
        }
        const output = result.markdown;
        if (result.strategy === 'generated') {
          violations.push({
            property: 'regeneration',
            detail,
            actual: output,
            expected: markdown,
          });
        }
        if (!readsBackAs(editor, output, doc)) {
          violations.push({
            property: 'round trip',
            detail,
            actual: String(parseMarkdown(editor, output).doc),
            expected: String(doc),
          });
        }
        const unexplained = unexplainedDifferences(editor, output, doc);
        if (unexplained.length > 0) {
          violations.push({
            property: 'judge',
            detail,
            actual: unexplained.join('\n'),
            expected: String(doc),
          });
        }
        if (
          kind === 'append' &&
          !insertsOnly(markdown, output, block.start, block.end)
        ) {
          violations.push({
            property: 'locality',
            detail: `${detail}, character by character`,
            actual: output,
            expected: markdown,
          });
        }
        // Lists of one type that deleting the block between them would bring
        // together have to be told apart by their markers.
        const previous = blocks[position - 1];
        const next = blocks[position + 1];
        const joinsLists =
          kind === 'delete' &&
          previous &&
          next &&
          LIST_TYPES.has(previous.node.type.name) &&
          previous.node.type === next.node.type;
        const end = joinsLists && next ? next.end : block.end;
        const before = markdown
          .slice(0, lineStart(markdown, block.start))
          .replace(/\n+$/, '');
        const after = markdown
          .slice(
            kind === 'insert'
              ? lineEnd(markdown, block.end)
              : lineEnd(markdown, end),
          )
          .replace(/^\n+/, '');
        const keepsLines =
          output.startsWith(before) &&
          output.endsWith(after) &&
          output.length >= before.length + after.length;
        if (!keepsLines) {
          violations.push({
            property: 'locality',
            detail,
            actual: output,
            expected: `${before}…${after}`,
          });
        }
      }
    }
  } finally {
    editor.destroy();
  }
  return violations;
}

const FRAGMENTS = [
  'para *em* _em_ **st** `code` text',
  'line one\nline two',
  'Setext\n===',
  'Setext two\n---',
  '# ATX',
  '## closed ##',
  '- a\n- b',
  '* a\n* b',
  '1. one\n2. two',
  '3) three',
  '- a\n\n  para in item\n- b',
  '- a\n  - nested\n  - nested two',
  '> quote\n> more',
  '> lazy\ncontinued',
  '```js\ncode\n```',
  '~~~\ntilde\n~~~',
  '    indented code',
  '***',
  '---',
  '<div class="note">\n\n**md**\n\n</div>',
  '<!-- comment -->',
  '[ref]: http://example.com',
  'see [ref] and [x][ref]',
  'a\\*b\\_c \\# &amp; &copy; \\{ruby|るび}',
  '| a | b |\n| - | - |\n| 1 | 2 |',
  '- [ ] task\n- [x] done',
  'text[^1]',
  '[^1]: note',
  '![image](a.png)',
  'https://example.com auto and user@example.com',
  'hard  \nbreak',
  'back\\\nslash',
  'a <span class="x">span</span> b',
  'para\n- interrupt',
  '以下の通り:\n- 項目A\n- 項目B',
  '10. ten\n11. eleven',
  'x ~~del~~ y and a|b',
  '$x^2$ and $$\ny\n$$',
  'はじめに',
  '# 第一章 https://a.jp',
  '連絡は user@example.com まで、詳細は www.example.com を参照',
  'これは「重要」です。金額（税込）は**千円**。',
  'これは<strong>「重要」</strong>で<em>（注）</em>です',
  '式 $x^2$ を示す。{漢字|かんじ}と $a_1$',
  '価格*1、送料*2 と __init__',
  'a\\\\b と $a \\\\ b$',
  '<https://example.com> &copy; a&nbsp;b',
  '本文\n![図](a.png)',
  '以下の通り：\n- 項目A',
];
const INSERTS = [
  'X',
  '*',
  '_',
  '`',
  '[',
  '1. ',
  '- ',
  '#',
  ' ',
  '<b>',
  '\\',
  '|',
  '>',
  '=',
  '~',
  '{',
  '$',
  '\n',
  '「',
  '」',
  '。',
  '（',
  '**',
  '__',
  '~~',
  '&amp;',
  'https://x.jp',
  ' user@a.jp ',
  'www.a.jp',
  '価格*1',
];
const MARKS = ['bold', 'italic', 'strike', 'code', 'link'];

/** Pieces of VFM's own syntax, and characters that start or end it. */
export const VFM_FRAGMENTS = [
  '{漢字|かんじ}と{**太**字|ふとじ}、{a\\|b|c}',
  '式$x = y$と$$\n\\sum_i a_i\n$$、価格は$5と$10',
  '注^[本文 *強調* と [リンク](u)]と^[複数\n行]',
  '参照[^1]と[^note]、Wow![^2]',
  '[^1]: 定義',
  '**強調**{.x}と`code`{#c}、[l](u){target=_blank}',
  '![a](b.png){.figure}',
  '> {引用|いんよう}の$y$^[注]',
  '*a $b* c$ と [a {b](u)|c}',
  'これは「重要」です。{漢字|かんじ}',
  '# 見出し {#sec .cls}\n## 小見出し\n{.blk}',
  '## 節を開かない ##\n#',
  '[^1]: 定義\n\n    二段落目\n\n本文[^1]',
  '[[toc]]',
  '- [ ] 未完了\n- [x] 完了',
  '![図の説明](fig.png){#fig}\n本文 ![a](b.png) 続き',
  '```js:app.js\nconst a = 1;\n```\n```py title="a b" {#c}\nx\n```',
];
export const VFM_INSERTS = [
  'X',
  '{',
  '}',
  '|',
  '$',
  '^',
  '[',
  ']',
  '*',
  '!',
  '\\',
  '「',
  '\n',
  '{a|b}',
  '$z$ ',
  '^[n]',
  '[^9]',
  '{.c}',
  '{#x}',
  '#',
  '[[toc]]',
  '[ ] ',
  '![i](i.png)',
];

/** A seeded pseudo-random number generator, so a failure can be replayed. */
function random(seed: number): (n: number) => number {
  let state = seed;
  return (n) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % n;
  };
}

/** Changes the document at random, in one of the ways a user would. */
function randomEdit(
  state: Editor['state'],
  rnd: (n: number) => number,
  inserts: readonly string[],
): { tr: Transaction; inserted: boolean } {
  const pick = <T>(items: readonly T[]): T => items[rnd(items.length)];
  const { schema } = state;
  const textblocks: { pos: number; node: ProseMirrorNode }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.isTextblock && !node.type.spec.code) {
      textblocks.push({ pos, node });
    }
  });
  const tr = state.tr;
  const kind = rnd(9);
  const range = () => {
    const { pos, node } = pick(textblocks);
    const from = pos + 1 + rnd(node.content.size + 1);
    const to = Math.min(pos + 1 + node.content.size, from + 1 + rnd(6));
    return { from, to };
  };
  if (kind <= 1 && textblocks.length > 0) {
    const { pos, node } = pick(textblocks);
    tr.insertText(pick(inserts), pos + 1 + rnd(node.content.size + 1));
    return { tr, inserted: true };
  }
  if (kind === 2 && state.doc.childCount > 1) {
    const index = rnd(state.doc.childCount);
    let offset = 0;
    for (let i = 0; i < index; i++) {
      offset += state.doc.child(i).nodeSize;
    }
    tr.delete(offset, offset + state.doc.child(index).nodeSize);
  } else if (kind === 3 && textblocks.length > 0) {
    const { pos, node } = pick(textblocks);
    if (node.content.size > 0) {
      tr.delete(pos + 1, pos + 2 + rnd(node.content.size));
    }
  } else if (kind === 4) {
    const items: { pos: number; node: ProseMirrorNode }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'listItem') {
        items.push({ pos, node });
      }
    });
    if (items.length > 0) {
      const { pos, node } = pick(items);
      tr.delete(pos, pos + node.nodeSize);
    }
  } else if (kind === 5 && textblocks.length > 0) {
    // Raw markdown under a mark means whatever the writer's markdown of it
    // reads as, which no judge independent of the writer can tell.
    const { from, to } = range();
    const name = pick(MARKS);
    const type = schema.marks[name];
    const raw = schema.marks.rawInline;
    if (type && from < to && !(raw && state.doc.rangeHasMark(from, to, raw))) {
      tr.addMark(
        from,
        to,
        type.create(name === 'link' ? { href: 'https://x.jp' } : null),
      );
    }
  } else if (kind === 6 && textblocks.length > 0) {
    const { from, to } = range();
    for (const name of MARKS) {
      const type = schema.marks[name];
      if (type) {
        tr.removeMark(from, to, type);
      }
    }
  } else if (kind === 7 && textblocks.length > 0) {
    const { pos, node } = pick(textblocks);
    tr.split(pos + 1 + rnd(node.content.size + 1));
  } else if (kind === 8 && textblocks.length > 1) {
    const index = rnd(textblocks.length - 1);
    const first = textblocks[index];
    tr.delete(
      first.pos + first.node.nodeSize - 1,
      textblocks[index + 1].pos + 1,
    );
  }
  return { tr, inserted: false };
}

export interface FuzzStatistics {
  /** How each save was written. */
  strategies: Map<string, number>;
  /** Saves after inserting text that removed something else. */
  collateral: number;
  saves: number;
}

/**
 * Builds documents from common pieces of syntax and edits them at random,
 * saving after every edit against the previous save, and checks that each
 * save reads back as the document, by the writer's comparison and by the
 * independent judge, and never gives up on the baseline.
 */
export function fuzzMarkdownEdits(
  createEditor: () => Editor,
  {
    seed,
    documents,
    edits,
    statistics,
    fragments = FRAGMENTS,
    inserts = INSERTS,
  }: {
    seed: number;
    documents: number;
    edits: number;
    statistics?: FuzzStatistics;
    /** What documents are made of. */
    fragments?: readonly string[];
    /** What is typed into them. */
    inserts?: readonly string[];
  },
): PropertyViolation[] {
  const rnd = random(seed);
  const pick = <T>(items: readonly T[]): T => items[rnd(items.length)];
  const violations: PropertyViolation[] = [];
  for (let n = 0; n < documents; n++) {
    const parts = Array.from({ length: 1 + rnd(5) }, () => pick(fragments));
    let markdown = parts[0];
    for (const part of parts.slice(1)) {
      markdown += pick(['\n', '\n\n', '\n\n', '\n\n\n']) + part;
    }
    markdown += pick(['', '\n', '\n\n']);
    const editor = createEditor();
    try {
      editor.commands.setMarkdown(markdown, { emitUpdate: false });
      for (let k = 0; k < edits; k++) {
        let edit: ReturnType<typeof randomEdit>;
        try {
          edit = randomEdit(editor.state, rnd, inserts);
          edit.tr.doc.check();
        } catch {
          continue;
        }
        if (!edit.tr.docChanged) {
          continue;
        }
        const baseline = editor.storage.pubMarkdown.baseline;
        editor.view.dispatch(edit.tr);
        const doc = editor.state.doc;
        const detail = `seed ${seed}: ${JSON.stringify(markdown)}, edit ${k}`;
        const result = write(editor, doc);
        if ('error' in result) {
          violations.push({
            property: 'error',
            detail,
            actual: result.error.markdown,
            expected: String(doc),
          });
          break;
        }
        if (statistics) {
          statistics.saves++;
          statistics.strategies.set(
            result.strategy,
            (statistics.strategies.get(result.strategy) ?? 0) + 1,
          );
          if (
            edit.inserted &&
            !insertsOnly(baseline, result.markdown, 0, baseline.length)
          ) {
            statistics.collateral++;
          }
        }
        if (result.strategy === 'generated') {
          violations.push({
            property: 'regeneration',
            detail,
            actual: result.markdown,
            expected: baseline,
          });
        }
        if (!readsBackAs(editor, result.markdown, doc)) {
          violations.push({
            property: 'round trip',
            detail,
            actual: String(parseMarkdown(editor, result.markdown).doc),
            expected: String(doc),
          });
        }
        const unexplained = unexplainedDifferences(
          editor,
          result.markdown,
          doc,
        );
        if (unexplained.length > 0) {
          violations.push({
            property: 'judge',
            detail,
            actual: `${unexplained.join('\n')}\n${result.markdown}`,
            expected: String(doc),
          });
        }
        editor.storage.pubMarkdown.baseline = result.markdown;
      }
    } finally {
      editor.destroy();
    }
  }
  return violations;
}
