import { Editor, type Extensions } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { dirname, relative } from 'pathe';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import type { SyncProvider } from '@v/sync-client';
import {
  currentNotations,
  type DocumentRecord,
  getMarkdown,
  MARKED_NOTATIONS,
  MarkdownWriteError,
  PubExtensions,
  parseMarkdown,
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
  onSaveError,
  writeFile,
}: {
  projectId: ProjectId;
  filename?: string;
  entryContext?: string;
  initialFile?: SandboxFile;
  sync?: EditorSyncContext;
  onSave: (content: { markdown: string; summary: string }) => void;
  /** Called when saving starts failing, and when it works again. */
  onSaveError?: (failing: boolean) => void;
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
        // An empty record removes the file's frontmatter, so it is only
        // made by removing recorded frontmatter, not by a file without any.
        const recorded = meta.get(FRONTMATTER_KEY);
        if (recorded !== frontmatter && (frontmatter || recorded)) {
          meta.set(FRONTMATTER_KEY, frontmatter);
        }
      }
    });
  };
  // Read on every write, by the extension: IndexedDB, the server and other
  // clients can change the record at any time.
  const documentRecord = (): DocumentRecord => {
    const notations = meta.get(NOTATIONS_KEY);
    return {
      notations:
        notations === undefined
          ? hasContent()
            ? MARKED_NOTATIONS
            : null
          : notations,
      frontmatter: meta.get(FRONTMATTER_KEY),
    };
  };
  // Editor state is persisted to IndexedDB keyed by a stable project + file
  // path. contentId is regenerated on every load, so it cannot serve as the
  // persistence key.
  const persistence = filename
    ? new IndexeddbPersistence(editorPersistenceKey(projectId, filename), doc)
    : undefined;

  let failed = false;
  const saveContent = debounce(
    (editor: Editor) => {
      let markdown: string;
      try {
        markdown = getMarkdown(editor);
      } catch (error) {
        // Saving it would change what the file means; the file keeps its
        // last good state, and the next edit tries again.
        if (error instanceof MarkdownWriteError) {
          if (!failed) {
            failed = true;
            console.error(error);
            onSaveError?.(true);
          }
          return;
        }
        throw error;
      }
      if (failed) {
        failed = false;
        onSaveError?.(false);
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
      documentRecord,
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
