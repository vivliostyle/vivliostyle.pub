import { Editor, type Extensions } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { dirname, relative } from 'pathe';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import type { SyncProvider } from '@v/sync-client';
import {
  currentNotations,
  getMarkdown,
  MARKED_NOTATIONS,
  MarkdownWriteError,
  PubExtensions,
  parseMarkdown,
  setDocumentNotations,
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

// Shared with the document, outside it: the definitions its content was read
// with and the frontmatter. Without the record it was made with marked, and
// is saved against the file as marked reads it rather than rewritten.
const MARKDOWN_META = 'markdown';
const NOTATIONS_KEY = 'notations';
const FRONTMATTER_KEY = 'frontmatter';

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

  // The file on disk is what saving compares the document with, also when
  // the document comes from IndexedDB or the server instead of the file.
  const markdown = (await initialFile?.text()) ?? '';
  const doc = new Y.Doc();
  const meta = doc.getMap<string>(MARKDOWN_META);
  const hasContent = () => doc.getXmlFragment('default').length > 0;
  const recordMarkdown = (editor: Editor, markdown?: string) => {
    doc.transact(() => {
      const notations = currentNotations(editor);
      if (meta.get(NOTATIONS_KEY) !== notations) {
        meta.set(NOTATIONS_KEY, notations);
      }
      if (markdown !== undefined) {
        const { frontmatter } = parseMarkdown(editor, markdown);
        if (meta.get(FRONTMATTER_KEY) !== frontmatter) {
          meta.set(FRONTMATTER_KEY, frontmatter);
        }
      }
    });
  };
  // Read when saving: IndexedDB, the server and other clients can change the
  // record at any time.
  const readRecord = (editor: Editor) => {
    const notations = meta.get(NOTATIONS_KEY);
    setDocumentNotations(
      editor,
      notations === undefined
        ? hasContent()
          ? MARKED_NOTATIONS
          : null
        : notations === currentNotations(editor)
          ? null
          : notations,
    );
    return meta.get(FRONTMATTER_KEY);
  };
  // Editor state is persisted to IndexedDB keyed by a stable project + file
  // path. contentId is regenerated on every load, so it cannot serve as the
  // persistence key.
  const persistence = filename
    ? new IndexeddbPersistence(editorPersistenceKey(projectId, filename), doc)
    : undefined;

  const saveContent = debounce(
    (editor: Editor) => {
      const frontmatter = readRecord(editor);
      let markdown: string;
      try {
        markdown = getMarkdown(
          editor,
          frontmatter === undefined ? {} : { frontmatter },
        );
      } catch (error) {
        // Saving it would change what the file means; the file keeps its
        // last good state, and the next edit tries again.
        if (error instanceof MarkdownWriteError) {
          console.error(error);
          return;
        }
        throw error;
      }
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
      onSetMarkdown: (editor) =>
        recordMarkdown(editor, editor.storage.pubMarkdown.baseline),
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

  setMarkdownBaseline(editor, markdown);

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
  if (!hasContent()) {
    if (markdown.trim()) {
      editor.commands.setMarkdown(markdown, { emitUpdate: false });
    } else {
      recordMarkdown(editor, markdown);
    }
  }

  return editor;
}
