import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { PubExtensions } from '../../src/index';
import {
  checkMarkdownProperties,
  type PropertyViolation,
} from '../../testing/markdown-properties';
import { removeSelectionMarks } from '../../testing/selection-marks';
import { suites } from '../cases/suites';

const createEditor = () =>
  new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });

// Violations a case's markdown cannot avoid, with why.
const KNOWN_VIOLATIONS: Record<
  string,
  {
    violations: Pick<PropertyViolation, 'property' | 'detail'>[];
    reason: string;
  }
> = {
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
