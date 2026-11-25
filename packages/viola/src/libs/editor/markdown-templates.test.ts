import { readdirSync, readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

import { PubExtensions, parseMarkdown } from '@v/tiptap-extensions';
import {
  checkMarkdownProperties,
  checkMarkedDocumentProperties,
} from '@v/tiptap-extensions/testing/markdown-properties';

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

describe('template manuscripts', () => {
  it.each(manuscripts)('%s keeps its guarantees', { timeout }, (path) => {
    const markdown = readFileSync(join(templatesDir, path), 'utf8');
    expect(checkMarkdownProperties(createEditor, markdown)).toEqual([]);
  });

  it.each(
    manuscripts,
  )('%s keeps its guarantees as a document made with marked', {
    timeout,
  }, (path) => {
    const markdown = readFileSync(join(templatesDir, path), 'utf8');
    expect(checkMarkedDocumentProperties(createEditor, markdown)).toEqual([]);
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
