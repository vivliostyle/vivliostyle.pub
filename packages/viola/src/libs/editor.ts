import { Editor, type Extensions } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import * as idb from 'idb';
import { join } from 'pathe';
import { ref } from 'valtio';
import * as Y from 'yjs';

import { PubExtensions } from '@v/tiptap-extensions';
import { debounce } from '../libs/debounce';
import { $content, type ContentId } from '../stores/content';
import { $sandbox } from '../stores/sandbox';

// @ts-ignore
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
  ({ editor, contentId }: { editor: Editor; contentId: ContentId }) => {
    const file = $content.files.get(contentId);
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
    $sandbox.files[
      join($sandbox.vivliostyleConfig.entryContext || '', file.filename)
    ] = ref(new Blob([markdown], { type: 'text/markdown' }));
  },
  1000,
  { trailing: true },
);

export async function setupEditor({
  contentId,
  initialFile,
}: {
  contentId: ContentId;
  initialFile?: Blob;
}) {
  // const doc = new Y.Doc();
  // await setupPersistence({ doc, contentId });

  const extensions = [
    PubExtensions.configure(),
    Placeholder.configure({
      placeholder: 'Start typing...',
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
