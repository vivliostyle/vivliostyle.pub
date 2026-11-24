import { readdirSync, readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

import { PubExtensions } from '@v/tiptap-extensions';
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

describe('template manuscripts', () => {
  it.each(manuscripts)('%s keeps its guarantees', (path) => {
    const markdown = readFileSync(join(templatesDir, path), 'utf8');
    expect(checkMarkdownProperties(createEditor, markdown)).toEqual([]);
  });
});
