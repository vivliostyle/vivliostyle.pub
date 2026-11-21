import { Editor, type Extensions } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { dirname, relative } from 'pathe';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import type { SyncProvider } from '@v/sync-client';
import { PubExtensions } from '@v/tiptap-extensions';
import type { ProjectId } from '../stores/proxies/project';
import { debounce } from './debounce';
import { createSandboxImageSaver } from './editor/image-saver';
import { insertExistingAsset } from './editor/insert-asset';
import { insertImageFiles } from './editor/insert-image';
import { createEditorMenuExtensions } from './editor/menu/extensions';
import { YUndoCursorFix } from './editor/y-undo-cursor-fix';
import { type EditorSyncContext, startEditorSync } from './editor-sync';
import type { SandboxFile } from './sandbox/file';

export type { EditorSyncContext } from './editor-sync';

function editorPersistenceKey(projectId: ProjectId, filename: string): string {
  return `viola:editor:${projectId}:${filename}`;
}

export function getEditorSummary(editor: Editor): string {
  return (
    editor
      .getText({ blockSeparator: '\n' })
      .split('\n')
      .find((s) => s.trim())
      ?.trim() || ''
  );
}

export async function setupEditor({
  projectId,
  filename,
  entryContext,
  initialFile,
  sync,
  onSave,
  writeFile,
}: {
  projectId: ProjectId;
  filename?: string;
  entryContext?: string;
  initialFile?: SandboxFile;
  sync?: EditorSyncContext;
  onSave: (content: { markdown: string; summary: string }) => void;
  writeFile: (path: string, file: SandboxFile) => void;
}) {
  const fileDir = filename ? dirname(filename) : '';
  let basePath = filename && relative(entryContext || '', dirname(filename));
  if (basePath?.startsWith('.')) {
    basePath = undefined;
  }

  const doc = new Y.Doc();
  // Editor state is persisted to IndexedDB keyed by a stable project + file
  // path. contentId is regenerated on every load, so it cannot serve as the
  // persistence key.
  const persistence = filename
    ? new IndexeddbPersistence(editorPersistenceKey(projectId, filename), doc)
    : undefined;

  const saveContent = debounce(
    (editor: Editor) => {
      onSave({
        markdown: editor.getMarkdown(),
        summary: getEditorSummary(editor),
      });
    },
    1000,
    { trailing: true },
  );

  const extensions = [
    PubExtensions.configure({
      basePath,
      fileDir,
      imageSaver: createSandboxImageSaver({ fileDir, writeFile }),
      onFileDrop: (editor, files, pos) => {
        insertImageFiles({ editor, files, pos });
      },
      onFilePaste: (editor, files) => {
        insertImageFiles({ editor, files });
      },
      onDrop: (editor, payload, pos) => {
        switch (payload.type) {
          case 'asset':
            insertExistingAsset({
              editor,
              assetPath: payload.path,
              pos,
            });
            return;
        }
      },
    }),
    Placeholder.configure({
      placeholder: 'Start typing...',
    }),
    ...createEditorMenuExtensions(),
    Collaboration.configure({
      document: doc,
    }),
    YUndoCursorFix,
  ] satisfies Extensions;

  const editor = new Editor({
    extensions,
    onUpdate: ({ editor }) => {
      saveContent(editor);
    },
  });

  let syncProvider: SyncProvider | undefined;
  editor.on('destroy', () => {
    saveContent.cancel();
    syncProvider?.disconnect();
    persistence?.destroy();
    doc.destroy();
  });

  // Load any previously persisted state first, then pull whatever the server
  // already has for this file. Seeding from the on-disk markdown only happens
  // when neither IndexedDB nor the server had any history — that keeps a
  // second tab from re-seeding an empty Y.Doc on top of the server's state.
  if (persistence) {
    await persistence.whenSynced;
  }
  if (sync && filename) {
    syncProvider = await startEditorSync({
      doc,
      sync,
      projectId,
      filename,
    });
  }
  if (doc.getXmlFragment('default').length === 0) {
    const markdown = (await initialFile?.text())?.trim();
    if (markdown) {
      editor.commands.setContent(markdown, {
        contentType: 'markdown',
        emitUpdate: false,
      });
    }
  }

  return editor;
}
