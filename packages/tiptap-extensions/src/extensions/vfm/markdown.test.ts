import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { Extensions } from '../..';
import { fromVfm, toVfm } from './io';

const schema = getSchema([Extensions]);

describe('identify', () => {
  it('blockquote', () => {
    const content = `> This is a blockquote.
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('break', () => {
    const content = `This is a line with a break.\\
And this is the next line.
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('code', () => {
    const content = `\`\`\`js
console.log('Hello, world!');
\`\`\`
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('delete', () => {
    const content = `~~deleted text~~
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('emphasis', () => {
    const content = `*italic text*
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('heading', () => {
    const content = `# Heading 1

## Heading 2

### Heading 3
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('inlineCode', () => {
    const content = `This is \`inline code\` in a paragraph.
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('list (bullet)', () => {
    const content = `* Item 1

* Item 2
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('list (ordered)', () => {
    const content = `1. First item

2. Second item
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('strong', () => {
    const content = `**bold text**
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });

  it('thematicBreak', () => {
    const content = `***
`;
    const doc = fromVfm(content, schema);
    const result = toVfm(doc, schema);
    expect(result).toBe(content);
  });
});
