import { createFileRoute } from '@tanstack/react-router';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { EditorContext, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ref } from 'valtio';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { PubExtensions } from '@v/tiptap-extensions';
import { InlineTrigger } from '@v/tiptap-extensions/inline-trigger';
import { Button } from '@v/ui/button';
import {
  EditArea,
  EditorStyleContainer,
} from '../../../components/content-editor';
import { ImageMenu } from '../../../components/content-editor/image-menu';
import { InlineMenu } from '../../../components/content-editor/inline-menu';
import { createObjectUrlImageSaver } from '../../../libs/editor/image-saver';
import {
  getAllTriggers,
  inlineMenuState,
} from '../../../libs/editor/inline-menu';
import { insertImageFiles } from '../../../libs/editor/insert-image';
import { YUndoCursorFix } from '../../../libs/editor/y-undo-cursor-fix';

import '../../../libs/editor/inline-menu.media';

const PERSISTENCE_NAME = 'viola:debug:indexeddb-persistence';

export const Route = createFileRoute('/debug/indexeddb-persistence/')({
  component: IndexeddbPersistenceDebugView,
});

type Handle = { doc: Y.Doc; persistence: IndexeddbPersistence };

function IndexeddbPersistenceDebugView() {
  const [handle, setHandle] = useState<Handle | null>(null);
  // Resources must be created inside useEffect so that StrictMode's dev-only
  // mount/unmount cycle creates a fresh Doc + IndexeddbPersistence on the real
  // mount; a useRef body-init pattern would reuse references that the
  // simulated unmount already destroyed (Y.Doc.destroy detaches the
  // persistence's update listener, so subsequent edits silently never reach
  // IndexedDB).
  useEffect(() => {
    const doc = new Y.Doc();
    const persistence = new IndexeddbPersistence(PERSISTENCE_NAME, doc);
    setHandle({ doc, persistence });
    return () => {
      persistence.destroy();
      doc.destroy();
      setHandle(null);
    };
  }, []);

  return (
    <div className="grid grid-cols-2 size-full divide-x divide-neutral-300">
      <section className="flex flex-col min-h-0">
        <header className="sticky top-0 z-10 bg-background px-6 py-2 border-b border-neutral-300 text-secondary-foreground font-semibold">
          Editor
        </header>
        <div className="flex-1 min-h-0 overflow-auto">
          {handle ? (
            <EditorPane key={handle.doc.guid} doc={handle.doc} />
          ) : (
            <InitMessage />
          )}
        </div>
      </section>
      <section className="flex flex-col min-h-0">
        <header className="sticky top-0 z-10 bg-background px-6 py-2 border-b border-neutral-300 text-secondary-foreground font-semibold">
          IndexedDB Updates Log
        </header>
        <div className="flex-1 min-h-0 overflow-auto">
          {handle ? (
            <UpdatesPane
              key={handle.doc.guid}
              doc={handle.doc}
              persistence={handle.persistence}
            />
          ) : (
            <InitMessage />
          )}
        </div>
      </section>
    </div>
  );
}

function InitMessage() {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      Initialising IndexedDB…
    </div>
  );
}

function EditorPane({ doc }: { doc: Y.Doc }) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      PubExtensions.configure({
        imageSaver: createObjectUrlImageSaver(),
        onFileDrop: (editor, files, pos) => {
          insertImageFiles({ editor, files, pos });
        },
        onFilePaste: (editor, files) => {
          insertImageFiles({ editor, files });
        },
      }),
      Placeholder.configure({
        placeholder:
          'Start typing — every keystroke is persisted to IndexedDB…',
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
      Collaboration.configure({ document: doc }),
      YUndoCursorFix,
    ],
  });

  return (
    <EditorContext.Provider value={{ editor }}>
      <div ref={wrapperRef} className="relative h-full">
        <EditorStyleContainer>
          <EditArea />
        </EditorStyleContainer>
        <InlineMenu containerRef={wrapperRef} />
        <ImageMenu containerRef={wrapperRef} />
      </div>
    </EditorContext.Provider>
  );
}

type UpdateEntry = {
  key: number;
  byteLength: number;
  structCount: number;
  deleteSetClients: number;
  preview: string;
};

function UpdatesPane({
  doc,
  persistence,
}: {
  doc: Y.Doc;
  persistence: IndexeddbPersistence;
}) {
  const [entries, setEntries] = useState<UpdateEntry[]>([]);
  const [synced, setSynced] = useState(persistence.synced);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await readAllUpdates(PERSISTENCE_NAME);
      setEntries(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onSynced = () => {
      setSynced(true);
      void refresh();
    };
    persistence.on('synced', onSynced);
    const onUpdate = () => {
      // y-indexeddb writes asynchronously inside its own update handler;
      // schedule a refresh on the next tick so the new row is visible.
      setTimeout(() => {
        void refresh();
      }, 0);
    };
    doc.on('update', onUpdate);
    return () => {
      persistence.off('synced', onSynced);
      doc.off('update', onUpdate);
    };
  }, [doc, persistence, refresh]);

  const clearData = useCallback(async () => {
    try {
      await clearStore(PERSISTENCE_NAME);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  const totalBytes = entries.reduce((sum, e) => sum + e.byteLength, 0);

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-muted-foreground">DB name</dt>
        <dd className="break-all">{PERSISTENCE_NAME}</dd>
        <dt className="text-muted-foreground">Synced</dt>
        <dd>{synced ? 'yes' : 'no'}</dd>
        <dt className="text-muted-foreground">Entries</dt>
        <dd>{entries.length}</dd>
        <dt className="text-muted-foreground">Total bytes</dt>
        <dd>{totalBytes.toLocaleString()}</dd>
      </dl>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={refresh}
          loading={loading}
        >
          Refresh
        </Button>
        <Button size="sm" variant="destructive" onClick={clearData}>
          Clear updates store
        </Button>
      </div>
      {error && (
        <div className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-xs font-mono">
          {error}
        </div>
      )}
      <table className="w-full border-collapse text-xs font-mono">
        <thead className="bg-accent text-left">
          <tr>
            <th className="px-2 py-1 border-b border-neutral-300">key</th>
            <th className="px-2 py-1 border-b border-neutral-300">bytes</th>
            <th className="px-2 py-1 border-b border-neutral-300">structs</th>
            <th className="px-2 py-1 border-b border-neutral-300">
              ds clients
            </th>
            <th className="px-2 py-1 border-b border-neutral-300">preview</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="px-2 py-4 text-center text-muted-foreground"
              >
                No updates persisted yet.
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <tr key={entry.key} className="align-top">
                <td className="px-2 py-1 border-b border-neutral-200">
                  {entry.key}
                </td>
                <td className="px-2 py-1 border-b border-neutral-200">
                  {entry.byteLength}
                </td>
                <td className="px-2 py-1 border-b border-neutral-200">
                  {entry.structCount}
                </td>
                <td className="px-2 py-1 border-b border-neutral-200">
                  {entry.deleteSetClients}
                </td>
                <td className="px-2 py-1 border-b border-neutral-200 break-all">
                  {entry.preview}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`open blocked for "${name}"`));
  });
}

function getAllWithKeys(
  store: IDBObjectStore,
): Promise<Array<{ key: number; value: Uint8Array }>> {
  return new Promise((resolve, reject) => {
    const results: Array<{ key: number; value: Uint8Array }> = [];
    const cursorReq = store.openCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      results.push({
        key: cursor.key as number,
        value: cursor.value as Uint8Array,
      });
      cursor.continue();
    };
  });
}

async function readAllUpdates(name: string): Promise<UpdateEntry[]> {
  const db = await openDb(name);
  try {
    if (!db.objectStoreNames.contains('updates')) {
      return [];
    }
    const tx = db.transaction(['updates'], 'readonly');
    const store = tx.objectStore('updates');
    const rows = await getAllWithKeys(store);
    return rows.map(({ key, value }) => describeUpdate(key, value));
  } finally {
    db.close();
  }
}

async function clearStore(name: string): Promise<void> {
  const db = await openDb(name);
  try {
    if (!db.objectStoreNames.contains('updates')) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['updates'], 'readwrite');
      tx.objectStore('updates').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function describeUpdate(key: number, raw: Uint8Array): UpdateEntry {
  try {
    const decoded = Y.decodeUpdate(raw);
    const dsClients = decoded.ds?.clients
      ? (decoded.ds.clients as Map<number, unknown>).size
      : 0;
    return {
      key,
      byteLength: raw.byteLength,
      structCount: decoded.structs.length,
      deleteSetClients: dsClients,
      preview: previewStructs(decoded.structs),
    };
  } catch (e) {
    return {
      key,
      byteLength: raw.byteLength,
      structCount: 0,
      deleteSetClients: 0,
      preview: `decode error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function previewStructs(structs: ReadonlyArray<unknown>): string {
  if (structs.length === 0) {
    return '∅';
  }
  const summary = structs.slice(0, 4).map((s) => {
    const ctor = (s as { constructor?: { name?: string } }).constructor?.name;
    const content = (s as { content?: unknown }).content;
    const contentCtor = (content as { constructor?: { name?: string } })
      ?.constructor?.name;
    const str = (content as { str?: string })?.str;
    if (typeof str === 'string') {
      return `${ctor ?? '?'}(${JSON.stringify(str.length > 24 ? `${str.slice(0, 24)}…` : str)})`;
    }
    if (contentCtor === 'ContentType') {
      // ContentType wraps an AbstractType instance (YXmlElement, YXmlFragment,
      // YText, …). Surface the wrapped type's class name, plus YXmlElement's
      // nodeName when present (e.g. "paragraph"), so the row distinguishes
      // structural inserts from each other.
      const wrapped = (content as { type?: unknown }).type;
      const wrappedCtor = (wrapped as { constructor?: { name?: string } })
        ?.constructor?.name;
      const nodeName = (wrapped as { nodeName?: string })?.nodeName;
      const inner = nodeName
        ? `${wrappedCtor ?? '?'}:${nodeName}`
        : (wrappedCtor ?? '?');
      return `${ctor ?? '?'}<${contentCtor}<${inner}>>`;
    }
    return contentCtor ? `${ctor ?? '?'}<${contentCtor}>` : (ctor ?? '?');
  });
  return structs.length > summary.length
    ? `${summary.join(', ')}, … +${structs.length - summary.length}`
    : summary.join(', ');
}
