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
