import { Editor, type Extensions } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { dirname, relative } from 'pathe';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import type { SyncProvider } from '@v/sync-client';
import {
  getMarkdown,
  PubExtensions,
  setMarkdownBaseline,
} from '@v/tiptap-extensions';
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

// Documents made while the editor parsed with marked hold content as marked
// read it. Rewriting a shared document from several clients would duplicate
// it, so they are kept and saved against the file as marked reads it.
const MARKDOWN_META = 'markdown';
const PARSER_KEY = 'parser';
const CURRENT_PARSER = 'remark';

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
  const meta = doc.getMap<string>(MARKDOWN_META);
  const markCurrentParser = () => {
    if (meta.get(PARSER_KEY) !== CURRENT_PARSER) {
      meta.set(PARSER_KEY, CURRENT_PARSER);
    }
  };
  // Editor state is persisted to IndexedDB keyed by a stable project + file
  // path. contentId is regenerated on every load, so it cannot serve as the
  // persistence key.
  const persistence = filename
    ? new IndexeddbPersistence(editorPersistenceKey(projectId, filename), doc)
    : undefined;

  const saveContent = debounce(
    (editor: Editor) => {
      const markdown = getMarkdown(editor);
      setMarkdownBaseline(editor, markdown);
      onSave({ markdown, summary: getEditorSummary(editor) });
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
      onSetMarkdown: markCurrentParser,
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
  // The file on disk is what saving compares the document with, also when
  // the document comes from IndexedDB or the server instead of the file.
  const markdown = (await initialFile?.text()) ?? '';
  if (doc.getXmlFragment('default').length > 0) {
    setMarkdownBaseline(editor, markdown, {
      legacy: meta.get(PARSER_KEY) !== CURRENT_PARSER,
    });
  } else if (markdown.trim()) {
    editor.commands.setMarkdown(markdown, { emitUpdate: false });
  } else {
    setMarkdownBaseline(editor, markdown, { legacy: false });
    markCurrentParser();
  }

  return editor;
}
