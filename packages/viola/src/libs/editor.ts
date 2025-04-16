import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import * as idb from 'idb';
import * as Y from 'yjs';
import { debounce } from '../libs/debounce';
import type { ContentId } from '../stores/content';

async function setupPersistence({
  doc,
}: { doc: Y.Doc; contentId: ContentId }): Promise<void> {
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

export async function setupEditor({ contentId }: { contentId: ContentId }) {
  const doc = new Y.Doc();
  await setupPersistence({ doc, contentId });

  return {
    doc,
    extensions: [
      StarterKit.configure({
        history: false,
      }),
      Placeholder.configure({
        placeholder: 'Start typing...',
      }),
      Collaboration.configure({
        document: doc,
      }),
    ],
  };
}
