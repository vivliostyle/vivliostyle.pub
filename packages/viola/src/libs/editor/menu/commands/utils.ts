import type { Editor } from '@tiptap/core';

import { findSelectedCodeBlock } from '@v/tiptap-extensions';

export function splitKeywords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function isInCodeBlock(editor: Editor): boolean {
  return findSelectedCodeBlock(editor.state) !== null;
}
