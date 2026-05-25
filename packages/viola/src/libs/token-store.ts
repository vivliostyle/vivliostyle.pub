import type { StoredTokens, TokenStore } from '@v/auth-client';

const DB_NAME = 'vivliostyle-pub:auth';
const DB_VERSION = 1;
const STORE = 'tokens';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const req = run(transaction.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => db.close();
      }),
  );
}

export class IndexedDBTokenStore implements TokenStore {
  constructor(private readonly key: string = 'default') {}

  async load(): Promise<StoredTokens | null> {
    try {
      const value = await tx('readonly', (s) => s.get(this.key));
      return (value as StoredTokens | undefined) ?? null;
    } catch {
      return null;
    }
  }

  async save(tokens: StoredTokens): Promise<void> {
    await tx('readwrite', (s) => s.put(tokens, this.key));
  }

  async clear(): Promise<void> {
    await tx('readwrite', (s) => s.delete(this.key));
  }
}
