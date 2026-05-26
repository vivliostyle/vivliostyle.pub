import * as Y from 'yjs';

import type { SqliteStore } from '../storage/sqlite-store';

export type DocUpdateListener = (update: Uint8Array, origin: unknown) => void;

function docKey(projectId: string, filename: string): string {
  return `${projectId}/${filename}`;
}

/**
 * Holds a live `Y.Doc` per (project, file), hydrated from and persisted to the
 * `Store`. Both the HTTP sync endpoint and the WebSocket transport operate on
 * the same document instance so updates from either path merge consistently.
 */
export class DocRegistry {
  private docs = new Map<string, Y.Doc>();
  private listeners = new Map<string, Set<DocUpdateListener>>();

  constructor(private store: SqliteStore) {}

  get(projectId: string, filename: string): Y.Doc {
    const key = docKey(projectId, filename);
    const existing = this.docs.get(key);
    if (existing) {
      return existing;
    }
    const doc = new Y.Doc();
    const state = this.store.loadDocState(projectId, filename);
    if (state) {
      Y.applyUpdate(doc, state);
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Persistence must not block broadcast — if writing to the store fails
      // (e.g. the dev server hot-reloaded and closed the previous SQLite
      // handle, but this Y.Doc is still serving in-flight WS connections),
      // we still need to fan the update out to other subscribers so realtime
      // collab keeps working until those connections naturally reconnect.
      try {
        this.store.saveDocState(
          projectId,
          filename,
          Y.encodeStateAsUpdate(doc),
        );
      } catch (err) {
        console.warn(
          `[sync] saveDocState failed for ${projectId}/${filename}: ${(err as Error).message}`,
        );
      }
      const set = this.listeners.get(key);
      if (set) {
        for (const cb of set) {
          try {
            cb(update, origin);
          } catch (err) {
            console.warn(
              `[sync] subscriber threw for ${projectId}/${filename}: ${(err as Error).message}`,
            );
          }
        }
      }
    });
    this.docs.set(key, doc);
    return doc;
  }

  applyUpdate(
    projectId: string,
    filename: string,
    update: Uint8Array,
    origin?: unknown,
  ): void {
    Y.applyUpdate(this.get(projectId, filename), update, origin);
  }

  encodeStateAsUpdate(
    projectId: string,
    filename: string,
    stateVector?: Uint8Array,
  ): Uint8Array {
    return Y.encodeStateAsUpdate(this.get(projectId, filename), stateVector);
  }

  encodeStateVector(projectId: string, filename: string): Uint8Array {
    return Y.encodeStateVector(this.get(projectId, filename));
  }

  subscribe(
    projectId: string,
    filename: string,
    listener: DocUpdateListener,
  ): () => void {
    const key = docKey(projectId, filename);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /**
   * Drop the in-memory doc and listeners for a (project, file). Used when a
   * file is deleted via the file API so a later re-creation starts from an
   * empty CRDT rather than the previously persisted state.
   */
  evict(projectId: string, filename: string): void {
    const key = docKey(projectId, filename);
    this.docs.delete(key);
    this.listeners.delete(key);
  }
}
