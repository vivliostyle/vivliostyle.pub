import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { PubExtensions } from '../../src/index';
import {
  checkMarkdownProperties,
  type PropertyViolation,
} from '../../testing/markdown-properties';
import { removeSelectionMarks } from '../../testing/selection-marks';
import { suites } from '../cases/suites';

// With the plugins, which keep nodes in a state their markdown can hold, as
// in the app: what they change on loading would change the file unedited.
const createEditor = () => {
  const editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  return editor;
};

// Violations a case's markdown cannot avoid, with why.
const KNOWN_VIOLATIONS: Record<
  string,
  {
    violations: Pick<PropertyViolation, 'property' | 'detail'>[];
    reason: string;
  }
> = {
  '[^1]: line1\nlazy': {
    violations: [
      {
        property: 'locality',
        detail: 'appending plain text to block 0, character by character',
      },
    ],
    reason:
      'a rewritten paragraph gives its lazy lines the prefix of the container, as in a quote or a list item',
  },
  '> a\nlazy': {
    violations: [
      {
        property: 'locality',
        detail: 'appending plain text to block 0, character by character',
      },
    ],
    reason:
      'a rewritten paragraph gives its lazy lines the prefix of the container, as in a quote or a list item',
  },
  '- a\nlazy': {
    violations: [
      {
        property: 'locality',
        detail: 'appending plain text to block 0, character by character',
      },
    ],
    reason:
      'a rewritten paragraph gives its lazy lines the prefix of the container, as in a quote or a list item',
  },
  '![a](a.png) \n\n ![b](b.png)\n\n> ![c](c.png) ': {
    violations: [
      {
        property: 'locality',
        detail: 'appending plain text to block 2, character by character',
      },
    ],
    reason:
      'the space that keeps an image alone in its paragraph is not in the document, so text after the image is written in its place',
  },
  '> a\n# H\n\n- b\n#\n\n[^1]: c\n## d': {
    violations: [0, 1, 2].map((block) => ({
      property: 'locality',
      detail: `appending plain text to block ${block}, character by character`,
    })),
    reason:
      'a rewritten paragraph gives its lazy lines the prefix of the container, as in a quote or a list item',
  },
  'a\nb\n---': {
    violations: [{ property: 'locality', detail: 'deleting block 0' }],
    reason:
      'a `---` that comes to open the file would start frontmatter, so it is written as `***`',
  },
  '$$\ny=1\n$$': {
    violations: [{ property: 'error', detail: 'making a heading of block 0' }],
    reason:
      'VFM 2 reads no setext heading of more than one line, and an ATX heading cannot hold the line breaks of display math',
  },
  '本文^[\\\n注\\\n\\\n]です。': {
    violations: [{ property: 'error', detail: 'making a heading of block 0' }],
    reason:
      'VFM 2 reads no setext heading of more than one line, and the writer writes no hard break of a note in an ATX heading as `<br>`',
  },
  'a\n\n---\n\nb': {
    violations: [{ property: 'locality', detail: 'deleting block 0' }],
    reason:
      'a `---` that comes to open the file would start frontmatter, so it is written as `***`',
  },
  '<!--': {
    violations: [
      { property: 'error', detail: 'inserting a paragraph after block 0' },
    ],
    reason:
      'blocks added after a raw block of an unclosed HTML comment stay separate blocks, though the comment takes in everything after it',
  },
  '---': {
    violations: [
      { property: 'identity', detail: 'saving the unedited document' },
    ],
    reason:
      'the thematic break writer turns `---` at the start of the document into `***` even when the block is unchanged and no later line would close frontmatter',
  },
  '{http://x|ふ}': {
    violations: [
      { property: 'identity', detail: 'saving the unedited document' },
      {
        property: 'round trip',
        detail: 'writing the document without a baseline',
      },
      { property: 'error', detail: 'making a heading of block 0' },
      { property: 'error', detail: 'inserting a paragraph after block 0' },
    ],
    reason:
      'a bare URL in the base of a ruby is read as a link that VFM does not make, and no markdown the writer tries reads back with it',
  },
  '^[http://x]': {
    violations: [
      { property: 'identity', detail: 'saving the unedited document' },
      {
        property: 'round trip',
        detail: 'writing the document without a baseline',
      },
      { property: 'error', detail: 'making a heading of block 0' },
      { property: 'error', detail: 'inserting a paragraph after block 0' },
    ],
    reason:
      'a bare URL in an inline footnote is read as a link that VFM does not make, and no markdown the writer tries reads back with it',
  },
  '- i\n#\n-': {
    violations: [
      { property: 'identity', detail: 'saving the unedited document' },
      {
        property: 'locality',
        detail: 'appending plain text to block 0, character by character',
      },
    ],
    reason:
      'a line of hashes that VFM reads as a lazy continuation of a list item ends the list in the editor, so the next item starts a new list',
  },
  '[^1]: # n {x}': {
    violations: [
      {
        property: 'regeneration',
        detail: 'deleting the first character of block 0',
      },
      {
        property: 'regeneration',
        detail: 'emptying the first textblock of block 0',
      },
    ],
    reason:
      'attributes moved to the next line of a heading are not indented into the footnote definition around it when the block is rewritten',
  },
  'm.co\n\nb': {
    violations: [
      { property: 'identity', detail: 'saving the unedited document' },
      { property: 'locality', detail: 'making a heading of block 1' },
      { property: 'locality', detail: 'deleting block 1' },
      { property: 'locality', detail: 'inserting a paragraph after block 1' },
    ],
    reason:
      'the link autolink plugin runs on the transaction that loads the file and links words that GFM does not read as links',
  },
  'x\n# [a http://b](c)\n\nd': {
    violations: [
      { property: 'identity', detail: 'saving the unedited document' },
      { property: 'locality', detail: 'making a heading of block 1' },
      { property: 'locality', detail: 'deleting block 1' },
      { property: 'locality', detail: 'inserting a paragraph after block 1' },
    ],
    reason:
      'the link autolink plugin links text inside raw inline markdown, which the writer then writes as link syntax around the raw source',
  },
  '`a\nb\nc`': {
    violations: [{ property: 'error', detail: 'making a heading of block 0' }],
    reason:
      'an ATX heading is one line, and code has no escapes for its line breaks',
  },
};

describe('markdown of every case', () => {
  const givens = new Set(
    suites.flatMap((suite) =>
      suite.cases.map((testCase) => removeSelectionMarks(testCase.given)),
    ),
  );
  it.each([...givens])('%j keeps its guarantees', (markdown) => {
    const violations = checkMarkdownProperties(createEditor, markdown).map(
      ({ property, detail }) => ({ property, detail }),
    );
    expect(violations).toEqual(KNOWN_VIOLATIONS[markdown]?.violations ?? []);
  });
});
