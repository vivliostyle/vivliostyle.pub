import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

import {
  getMarkdownWithResult,
  MARKED_NOTATIONS,
  markdownPipeline,
  parseMarkdown,
  setDocumentNotations,
  setMarkdownBaseline,
} from '../markdown/extension';
import { createLegacyBaselineReader } from '../markdown/legacy';
import { splitSource } from '../markdown/source';
import { MarkdownWriteError } from '../markdown/write';

/** A way the markdown conversion breaks one of its guarantees. */
export interface PropertyViolation {
  property: 'identity' | 'locality' | 'round trip' | 'regeneration' | 'error';
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

type Edit = [string, (tr: Transaction) => void, 'edit' | 'delete' | 'insert'];

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
      (tr) => tr.insertText('X', end(last)),
      'edit',
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

/**
 * Loads `markdown` as the editor did before it moved to remark, the way the
 * old parser read the whole file.
 */
export function loadAsMarkedDocument(editor: Editor, markdown: string): void {
  const { body } = splitSource(markdown);
  const doc = createLegacyBaselineReader(
    editor.schema,
    editor.extensionManager.extensions,
  ).readDocument(body);
  if (!doc) {
    throw new Error('The old parser did not read the markdown');
  }
  editor.commands.setContent(doc.toJSON(), { emitUpdate: false });
  setMarkdownBaseline(editor, markdown);
  setDocumentNotations(editor, MARKED_NOTATIONS);
}

function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  return a.slice(head, a.length - tail);
}

/**
 * Checks a document the old parser made from `markdown`: saving it unedited
 * gives the file back, and appending to one textblock changes no more lines
 * than that textblock has.
 */
export function checkMarkedDocumentProperties(
  createEditor: () => Editor,
  markdown: string,
): PropertyViolation[] {
  const violations: PropertyViolation[] = [];
  const editor = createEditor();
  try {
    loadAsMarkedDocument(editor, markdown);
    const saved = write(editor, editor.state.doc);
    if ('error' in saved || saved.markdown !== markdown) {
      violations.push({
        property: 'identity',
        detail: 'saving the unedited document',
        actual: 'error' in saved ? String(saved.error) : saved.markdown,
        expected: markdown,
      });
    }
    editor.state.doc.forEach((child, offset, index) => {
      let target: { pos: number; node: ProseMirrorNode } | undefined;
      child.descendants((node, pos) => {
        if (
          !target &&
          node.isTextblock &&
          !node.type.spec.code &&
          node.content.size > 0
        ) {
          target = { pos: offset + 1 + pos, node };
        }
        return !target;
      });
      if (!target) {
        return;
      }
      const doc = editor.state.tr.insertText(
        'X',
        target.pos + target.node.nodeSize - 1,
      ).doc;
      const result = write(editor, doc);
      const detail = `appending to block ${index}`;
      if ('error' in result) {
        violations.push({
          property: 'error',
          detail,
          actual: result.error.markdown,
          expected: String(doc),
        });
        return;
      }
      const changed = changedLines(markdown, result.markdown);
      if (changed.length > target.node.textContent.split('\n').length + 2) {
        violations.push({
          property: 'locality',
          detail,
          actual: changed.join('\n'),
          expected: target.node.textContent,
        });
      }
    });
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
];

/** A seeded pseudo-random number generator, so a failure can be replayed. */
function random(seed: number): (n: number) => number {
  let state = seed;
  return (n) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % n;
  };
}

/**
 * Builds documents from common pieces of syntax and edits them at random,
 * saving after every edit against the previous save, and checks that each
 * save reads back as the document and never gives up on the baseline.
 */
export function fuzzMarkdownEdits(
  createEditor: () => Editor,
  {
    seed,
    documents,
    edits,
    strategies,
  }: {
    seed: number;
    documents: number;
    edits: number;
    /** Counts how each save was written. */
    strategies?: Map<string, number>;
  },
): PropertyViolation[] {
  const rnd = random(seed);
  const pick = <T>(items: readonly T[]): T => items[rnd(items.length)];
  const violations: PropertyViolation[] = [];
  for (let n = 0; n < documents; n++) {
    const parts = Array.from({ length: 1 + rnd(5) }, () => pick(FRAGMENTS));
    let markdown = parts[0];
    for (const part of parts.slice(1)) {
      markdown += pick(['\n', '\n\n', '\n\n', '\n\n\n']) + part;
    }
    markdown += pick(['', '\n', '\n\n']);
    const editor = createEditor();
    try {
      editor.commands.setMarkdown(markdown, { emitUpdate: false });
      for (let k = 0; k < edits; k++) {
        const { state } = editor;
        const textblocks: { pos: number; node: ProseMirrorNode }[] = [];
        state.doc.descendants((node, pos) => {
          if (node.isTextblock && !node.type.spec.code) {
            textblocks.push({ pos, node });
          }
        });
        const tr = state.tr;
        const kind = rnd(5);
        try {
          if (kind <= 1 && textblocks.length > 0) {
            const { pos, node } = pick(textblocks);
            tr.insertText(pick(INSERTS), pos + 1 + rnd(node.content.size + 1));
          } else if (kind === 2 && state.doc.childCount > 1) {
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
          } else {
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
          }
        } catch {
          continue;
        }
        if (!tr.docChanged) {
          continue;
        }
        try {
          tr.doc.check();
        } catch {
          continue;
        }
        editor.view.dispatch(tr);
        const doc = editor.state.doc;
        const detail = `${JSON.stringify(markdown)}, edit ${k}`;
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
        strategies?.set(
          result.strategy,
          (strategies.get(result.strategy) ?? 0) + 1,
        );
        if (result.strategy === 'generated') {
          violations.push({
            property: 'regeneration',
            detail,
            actual: result.markdown,
            expected: editor.storage.pubMarkdown.baseline,
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
        editor.storage.pubMarkdown.baseline = result.markdown;
      }
    } finally {
      editor.destroy();
    }
  }
  return violations;
}
