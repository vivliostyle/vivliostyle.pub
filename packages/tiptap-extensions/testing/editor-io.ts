import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export function loadMarkdown(editor: Editor, markdown: string): void {
  editor.commands.setContent(markdown, {
    contentType: 'markdown',
    emitUpdate: false,
  });
}

export function serializeDoc(editor: Editor, doc: ProseMirrorNode): string {
  const manager = editor.markdown;
  if (!manager) {
    throw new Error('The editor has no markdown extension');
  }
  return manager.serialize(doc.toJSON());
}
