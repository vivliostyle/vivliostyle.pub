import { readdirSync, readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

import { PubExtensions, parseMarkdown } from '@v/tiptap-extensions';
import { checkMarkdownProperties } from '@v/tiptap-extensions/testing/markdown-properties';

const templatesDir = join(import.meta.dirname, '../../../templates');

const manuscripts = readdirSync(templatesDir, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith('.md'))
  .sort();

const createEditor = () =>
  new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });

// Every block is edited several ways, each saved and read back.
const timeout = 60_000;

// VFM 2 reads no setext heading of more than one line, and an ATX heading
// cannot hold the line breaks of display math, so a paragraph of it cannot
// be made a heading.
function isKnown(
  markdown: string,
  { property, detail }: { property: string; detail: string },
): boolean {
  const index = Number(detail.match(/^making a heading of block (\d+)$/)?.[1]);
  if (property !== 'error' || Number.isNaN(index)) {
    return false;
  }
  const editor = createEditor();
  editor.commands.setMarkdown(markdown);
  const block = editor.state.doc.maybeChild(index);
  editor.destroy();
  return (
    block?.childCount === 1 &&
    block.firstChild?.type.name === 'math' &&
    /\n/.test(String(block.firstChild.attrs.latex))
  );
}

describe('template manuscripts', () => {
  it.each(manuscripts)('%s keeps its guarantees', { timeout }, (path) => {
    const markdown = readFileSync(join(templatesDir, path), 'utf8');
    expect(
      checkMarkdownProperties(createEditor, markdown).filter(
        (it) => !isKnown(markdown, it),
      ),
    ).toEqual([]);
  });
});

describe('markup of themes in the basic template', () => {
  // The guarantees above hold for raw HTML too, so this tells that the
  // manuscripts' notes and boxes are read as the theme's elements.
  it.each([
    ['basic/drafts/05_examples.md', 'htmlFootnote', 3],
    ['basic/drafts/06_styling-guide.md', 'htmlFootnote', 2],
    ['basic/drafts/06_styling-guide.md', 'noteBlock', 1],
    ['basic/drafts/06_styling-guide.md', 'warningBlock', 1],
  ])('%s holds %s %i times', (path, type, count) => {
    const editor = createEditor();
    const markdown = readFileSync(join(templatesDir, path), 'utf8');
    let found = 0;
    parseMarkdown(editor, markdown).doc.descendants((node) => {
      found += node.type.name === type ? 1 : 0;
    });
    editor.destroy();
    expect(found).toBe(count);
  });
});
