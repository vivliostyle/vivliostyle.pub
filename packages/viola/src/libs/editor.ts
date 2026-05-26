import { Editor, type Extensions } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { dirname, relative } from 'pathe';
import { ref } from 'valtio';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import type { ApiClient } from '@v/api-client';
import type { AuthClient } from '@v/auth-client';
import {
  HttpPollingSyncProvider,
  type SyncProvider,
  WebSocketSyncProvider,
} from '@v/sync-client';
import { PubExtensions } from '@v/tiptap-extensions';
import { InlineTrigger } from '@v/tiptap-extensions/inline-trigger';
import { debounce } from '../libs/debounce';
import { $projects } from '../stores/accessors';
import type { ContentId } from '../stores/proxies/content';
import type { ProjectId } from '../stores/proxies/project';
import { SandboxFile } from '../stores/proxies/sandbox';
import { createSandboxImageSaver } from './editor/image-saver';
import { getAllTriggers, inlineMenuState } from './editor/inline-menu';
import { insertExistingAsset } from './editor/insert-asset';
import { insertImageFiles } from './editor/insert-image';
import { YUndoCursorFix } from './editor/y-undo-cursor-fix';

import './editor/inline-menu.media';

function editorPersistenceKey(projectId: ProjectId, filename: string): string {
  return `viola:editor:${projectId}:${filename}`;
}

export interface EditorSyncContext {
  api: ApiClient;
  auth: AuthClient;
}

export async function setupEditor({
  projectId,
  contentId,
  filename,
  entryContext,
  initialFile,
  sync,
}: {
  projectId: ProjectId;
  contentId: ContentId;
  filename?: string;
  entryContext?: string;
  initialFile?: SandboxFile;
  sync?: EditorSyncContext;
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

  // Resolve the owning project via projectId rather than the current-project
  // accessors so persisted-state hydration writes back to the right sandbox
  // even when this project has not yet been made current.
  const saveContent = debounce(
    (editor: Editor) => {
      const project = $projects.value[projectId];
      const sandbox = project?.sandbox;
      if (!project || !sandbox) {
        return;
      }
      const file = project.content.files.get(contentId);
      if (!file) {
        return;
      }
      file.summary =
        editor
          .getText({ blockSeparator: '\n' })
          .split('\n')
          .find((s) => s.trim())
          ?.trim() || '';
      const markdown = editor.getMarkdown();
      sandbox.files[file.filename] = ref(
        new SandboxFile('text/markdown', markdown),
      );
    },
    1000,
    { trailing: true },
  );

  const extensions = [
    PubExtensions.configure({
      basePath,
      fileDir,
      imageSaver: createSandboxImageSaver({ fileDir }),
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
    InlineTrigger.configure({
      triggers: getAllTriggers(),
      isMenuOpen: () => inlineMenuState.trigger !== null,
      onDismiss: () => inlineMenuState.closeInlineMenu(),
      onTrigger: (editor, trigger, from, coords) => {
        inlineMenuState.trigger = trigger;
        inlineMenuState.editor = ref(editor);
        inlineMenuState.from = from;
        inlineMenuState.coords = coords;
      },
    }),
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

async function startEditorSync({
  doc,
  sync,
  projectId,
  filename,
}: {
  doc: Y.Doc;
  sync: EditorSyncContext;
  projectId: ProjectId;
  filename: string;
}): Promise<SyncProvider | undefined> {
  // Pull the server's state first so we don't re-seed an existing doc from
  // local markdown on top of whatever collaborators have already written.
  try {
    const stateVector = Y.encodeStateVector(doc);
    const diff = await sync.api.syncPush(
      projectId,
      filename,
      new Uint8Array(),
      stateVector,
    );
    if (diff.byteLength > 0) {
      Y.applyUpdate(doc, diff);
    }
  } catch {
    // Initial sync is best-effort; live providers below will keep retrying.
  }

  const ws = new WebSocketSyncProvider({
    url: async () => {
      const token = await sync.auth.getAccessToken();
      if (!token) {
        throw new Error('Not authenticated; cannot open sync WebSocket');
      }
      return sync.api.syncWebSocketUrl(projectId, filename, token);
    },
    doc,
  });
  let active: SyncProvider = ws;
  let fallbackStarted = false;
  const unsubscribe = ws.onStatusChange((status) => {
    if (status !== 'error' || fallbackStarted) {
      return;
    }
    fallbackStarted = true;
    unsubscribe();
    ws.disconnect();
    const polling = new HttpPollingSyncProvider({
      transport: sync.api,
      projectId,
      filename,
      doc,
    });
    active = polling;
    void polling.connect().catch(() => {
      // Polling provider retains pending updates internally and the interval
      // timer keeps retrying; nothing actionable to do here.
    });
  });
  try {
    await ws.connect();
  } catch {
    // Either provider keeps trying in the background; surface nothing here.
  }
  return {
    get status() {
      return active.status;
    },
    connect: () => active.connect(),
    disconnect: () => active.disconnect(),
    onStatusChange: (listener) => active.onStatusChange(listener),
  };
}
