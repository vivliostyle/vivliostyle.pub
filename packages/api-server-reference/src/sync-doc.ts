import * as Y from 'yjs';

import type { Store } from './store';

export type DocUpdateListener = (update: Uint8Array, origin: unknown) => void;

/**
 * Holds a live `Y.Doc` per project, hydrated from and persisted to the `Store`.
 * Both the HTTP sync endpoint and the WebSocket transport operate on the same
 * document instance so updates from either path are merged consistently.
 */
export class DocRegistry {
  private docs = new Map<string, Y.Doc>();
  private listeners = new Map<string, Set<DocUpdateListener>>();

  constructor(private store: Store) {}

  get(projectId: string): Y.Doc {
    const existing = this.docs.get(projectId);
    if (existing) {
      return existing;
    }
    const doc = new Y.Doc();
    const state = this.store.loadDocState(projectId);
    if (state) {
      Y.applyUpdate(doc, state);
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.store.saveDocState(projectId, Y.encodeStateAsUpdate(doc));
      const set = this.listeners.get(projectId);
      if (set) {
        for (const cb of set) {
          cb(update, origin);
        }
      }
    });
    this.docs.set(projectId, doc);
    return doc;
  }

  applyUpdate(projectId: string, update: Uint8Array, origin?: unknown): void {
    Y.applyUpdate(this.get(projectId), update, origin);
  }

  encodeStateAsUpdate(projectId: string, stateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.get(projectId), stateVector);
  }

  encodeStateVector(projectId: string): Uint8Array {
    return Y.encodeStateVector(this.get(projectId));
  }

  subscribe(projectId: string, listener: DocUpdateListener): () => void {
    let set = this.listeners.get(projectId);
    if (!set) {
      set = new Set();
      this.listeners.set(projectId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }
}
