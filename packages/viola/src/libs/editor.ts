import { Editor, type Extensions } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import * as idb from 'idb';
import { dirname, relative } from 'pathe';
import { ref } from 'valtio';
import * as Y from 'yjs';

import { PubExtensions } from '@v/tiptap-extensions';
import { InlineTrigger } from '@v/tiptap-extensions/inline-trigger';
import { debounce } from '../libs/debounce';
import { $content, $sandbox } from '../stores/accessors';
import type { ContentId } from '../stores/proxies/content';
import { SandboxFile } from '../stores/proxies/sandbox';
import { createSandboxImageSaver } from './editor/image-saver';
import { getAllTriggers, inlineMenuState } from './editor/inline-menu';
import { insertExistingAsset } from './editor/insert-asset';
import { insertImageFiles } from './editor/insert-image';

import './editor/inline-menu.media';

// @ts-expect-error
async function _setupPersistence({
  doc,
}: {
  doc: Y.Doc;
  contentId: ContentId;
}): Promise<void> {
  const preferredTrimSize = 500;
  const storeName = 'update';
  // @ts-expect-error
  const origin = this as unknown;
  const db = await idb.openDB('viola:editor', 1, {
    upgrade(db) {
      db.createObjectStore(storeName, { autoIncrement: true });
    },
  });

  let dbRef = 0;
  let dbSize = 0;
  fetchUpdate(true);

  async function fetchUpdate(init = false) {
    const tx = db.transaction(storeName, 'readwrite');
    const updates = await tx.store.getAll(IDBKeyRange.lowerBound(dbRef, false));
    if (init) {
      await tx.store.add(Y.encodeStateAsUpdate(doc));
    }
    Y.transact(
      doc,
      () => {
        for (const update of updates) {
          Y.applyUpdate(doc, update);
        }
      },
      origin,
      false,
    );
    const lastKey = (await tx.store.openKeyCursor(null, 'prev'))?.key;
    dbRef = ((lastKey as number) ?? 0) + 1;
    dbSize = await tx.store.count();
    await tx.done;
  }

  const storeState = debounce(
    async function storeState() {
      await fetchUpdate();
      if (dbSize >= preferredTrimSize) {
        const tx = db.transaction(storeName, 'readwrite');
        await tx.store.add(Y.encodeStateAsUpdate(doc));
        await tx.store.delete(IDBKeyRange.upperBound(dbRef, true));
        dbSize = await tx.store.count();
        await tx.done;
      }
    },
    1000,
    { trailing: true },
  );

  function onUpdate(update: Uint8Array, _origin: unknown) {
    if (origin === _origin) {
      return;
    }
    const tr = db.transaction(storeName, 'readwrite');
    tr.store.add(update);
    if (++dbSize >= preferredTrimSize) {
      storeState();
    }
  }

  function onDestroy() {
    doc.off('update', onUpdate);
    doc.off('destroy', onDestroy);
  }

  doc.on('update', onUpdate);
  doc.on('destroy', onDestroy);
}

const saveContent = debounce(
  async ({ editor, contentId }: { editor: Editor; contentId: ContentId }) => {
    const $$content = $content.valueOrThrow();
    const $$sandbox = $sandbox.valueOrThrow();
    const file = $$content.files.get(contentId);
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
    $$sandbox.files[file.filename] = ref(
      new SandboxFile('text/markdown', markdown),
    );
  },
  1000,
  { trailing: true },
);

export async function setupEditor({
  contentId,
  filename,
  entryContext,
  initialFile,
}: {
  contentId: ContentId;
  filename?: string;
  entryContext?: string;
  initialFile?: SandboxFile;
}) {
  const fileDir = filename ? dirname(filename) : '';
  let basePath = filename && relative(entryContext || '', dirname(filename));
  if (basePath?.startsWith('.')) {
    basePath = undefined;
  }

  // const doc = new Y.Doc();
  // await setupPersistence({ doc, contentId });

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
    // Collaboration.configure({
    //   document: doc,
    // }),
  ] satisfies Extensions;

  const markdown = await initialFile?.text();
  return new Editor({
    extensions,
    content: markdown?.trim(),
    contentType: 'markdown',
    onUpdate: ({ editor }) => {
      saveContent({ editor, contentId });
    },
  });
}
