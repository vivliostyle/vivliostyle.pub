import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { getMarkdown, setMarkdownBaseline } from '../markdown/extension';
import { MarkdownWriteError } from '../markdown/write';
import { CARET } from './selection-marks';

export function loadMarkdown(editor: Editor, markdown: string): void {
  editor.commands.setMarkdown(markdown, { emitUpdate: false });
  // The file on disk has no selection marks.
  setMarkdownBaseline(editor, markdown.replaceAll(CARET, ''));
}

/** Saves the document as the editor would, against the loaded markdown. */
export function serializeDoc(editor: Editor, doc: ProseMirrorNode): string {
  try {
    return getMarkdown(editor, { doc });
  } catch (error) {
    // The editor would refuse to save it, which a case compares as output.
    if (error instanceof MarkdownWriteError) {
      return `[${error.message}]\n${error.markdown}`;
    }
    throw error;
  }
}
