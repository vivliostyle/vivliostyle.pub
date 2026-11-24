import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { getMarkdown, parseMarkdown } from '../markdown';
import { splitSource } from '../markdown/source';

/** A way the markdown conversion breaks one of its guarantees. */
export interface PropertyViolation {
  property: 'identity' | 'locality' | 'round trip';
  detail: string;
  actual: string;
  expected: string;
}

const LIST_TYPES = new Set(['bulletList', 'orderedList']);

function written(doc: ProseMirrorNode): string[] {
  const blocks: string[] = [];
  doc.forEach((child) => {
    if (!(child.isTextblock && child.childCount === 0)) {
      blocks.push(JSON.stringify(child.toJSON()));
    }
  });
  return blocks;
}

function sameContent(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
  return written(a).join('\n') === written(b).join('\n');
}

interface Block {
  index: number;
  start: number;
  end: number;
  /** Where to append text so the block changes, if it has such a place. */
  appendAt: number | undefined;
}

function blocksOf(editor: Editor, markdown: string): Block[] {
  const pipeline = editor.storage.pubMarkdown.pipeline;
  if (!pipeline) {
    throw new Error('The markdown pipeline has not been set up');
  }
  const { frontmatter, body } = splitSource(markdown);
  const parsed = pipeline.parseBody(body);
  const blocks: Block[] = [];
  let pos = 0;
  editor.state.doc.forEach((child, offset, index) => {
    pos = offset;
    const range = parsed.ranges.get(parsed.doc.child(index));
    if (!range) {
      return;
    }
    let appendAt: number | undefined;
    child.descendants((node, nodePos) => {
      if (
        appendAt === undefined &&
        node.isTextblock &&
        !node.type.spec.code &&
        node.childCount > 0
      ) {
        appendAt = pos + 1 + nodePos + node.nodeSize - 1;
      }
      return appendAt === undefined;
    });
    blocks.push({
      index,
      start: frontmatter.length + range.start,
      end: frontmatter.length + range.end,
      appendAt,
    });
  });
  return blocks;
}

function lineStart(text: string, index: number): number {
  return text.lastIndexOf('\n', index - 1) + 1;
}

function lineEnd(text: string, index: number): number {
  const end = text.indexOf('\n', index);
  return end === -1 ? text.length : end;
}

/**
 * Loads `markdown` and checks that saving it gives it back byte for byte,
 * that editing or deleting one top-level block changes only that block's
 * lines, and that whatever is written reads back as the same document. Line
 * endings are expected as `\n`.
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

    const saved = getMarkdown(editor);
    if (saved !== markdown) {
      violations.push({
        property: 'identity',
        detail: 'saving the unedited document',
        actual: saved,
        expected: markdown,
      });
    }

    const generated = getMarkdown(editor, { baseline: '' });
    if (!sameContent(parseMarkdown(editor, generated).doc, original)) {
      violations.push({
        property: 'round trip',
        detail: 'writing the document without a baseline',
        actual: String(parseMarkdown(editor, generated).doc),
        expected: String(original),
      });
    }

    const blocks = blocksOf(editor, markdown);
    for (const [position, block] of blocks.entries()) {
      const edits: [string, ProseMirrorNode][] = [];
      if (block.appendAt !== undefined) {
        edits.push([
          `appending to block ${block.index}`,
          editor.state.tr.insertText('X', block.appendAt).doc,
        ]);
      }
      const child = original.child(block.index);
      let offset = 0;
      for (let i = 0; i < block.index; i++) {
        offset += original.child(i).nodeSize;
      }
      if (original.childCount > 1) {
        edits.push([
          `deleting block ${block.index}`,
          editor.state.tr.delete(offset, offset + child.nodeSize).doc,
        ]);
      }
      for (const [detail, doc] of edits) {
        const output = getMarkdown(editor, { doc });
        // Lists of one type that deleting the block between them would bring
        // together have to be told apart by their markers.
        const previous = blocks[position - 1];
        const next = blocks[position + 1];
        const joinsLists =
          detail.startsWith('deleting') &&
          previous &&
          next &&
          LIST_TYPES.has(original.child(previous.index).type.name) &&
          original.child(previous.index).type ===
            original.child(next.index).type;
        const end = joinsLists && next ? next.end : block.end;
        const reread = parseMarkdown(editor, output).doc;
        if (!sameContent(reread, doc)) {
          violations.push({
            property: 'round trip',
            detail,
            actual: String(reread),
            expected: String(doc),
          });
        }
        const before = markdown.slice(0, lineStart(markdown, block.start));
        const after = markdown.slice(lineEnd(markdown, end));
        const keepsLines =
          output.startsWith(before.replace(/\n+$/, '')) &&
          output.endsWith(after.replace(/^\n+/, '')) &&
          output.length >=
            before.replace(/\n+$/, '').length +
              after.replace(/^\n+/, '').length;
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
