import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { suites } from '../cases';
import { PubExtensions } from '../index';
import { checkMarkdownProperties } from '../testing/markdown-properties';
import { removeSelectionMarks } from '../testing/selection-marks';

const createEditor = () =>
  new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });

// Raw markdown is kept as written, but what it means can depend on other
// blocks.
const KNOWN_VIOLATIONS: Record<string, string> = {
  'text[^1]\n\n[^1]: note':
    'a footnote reference reads as text once its definition is deleted',
  'a[^1] b\n\n[^1]: note':
    'a footnote reference reads as text once its definition is deleted',
  '脚注[^1]です。\n\n[^1]: 本文':
    'a footnote reference reads as text once its definition is deleted',
};

describe('markdown of every case', () => {
  const givens = new Set(
    suites.flatMap((suite) =>
      suite.cases.map((testCase) => removeSelectionMarks(testCase.given)),
    ),
  );
  it.each([...givens])('%j keeps its guarantees', (markdown) => {
    const violations = checkMarkdownProperties(createEditor, markdown);
    if (KNOWN_VIOLATIONS[markdown]) {
      expect(violations).not.toEqual([]);
    } else {
      expect(violations).toEqual([]);
    }
  });
});
