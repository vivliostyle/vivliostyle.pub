import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { suites } from '../cases';
import { PubExtensions } from '../index';
import {
  checkMarkdownProperties,
  type PropertyViolation,
} from '../testing/markdown-properties';
import { removeSelectionMarks } from '../testing/selection-marks';

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
