export type ProviderKind = 'opfs' | 'indexeddb' | 'local' | 'git' | 'remote';

export interface ProviderMetadata {
  kind: ProviderKind;
  label: string;
  description?: string;
}

export interface ProviderCapabilities {
  versioning: boolean;
  binary: boolean;
  realtime: boolean;
  remote: boolean;
}

export interface FileMeta {
  mtimeMs?: number;
  size?: number;
  mimeType?: string;
}

export interface ListEntry {
  path: string;
  kind: 'file' | 'directory';
  meta?: FileMeta;
}

export interface ReadOptions {
  signal?: AbortSignal;
}

export interface WriteOptions {
  signal?: AbortSignal;
  mimeType?: string;
}

export interface ListOptions {
  signal?: AbortSignal;
  recursive?: boolean;
  ignore?: readonly RegExp[];
}

export interface RemoveOptions {
  signal?: AbortSignal;
  recursive?: boolean;
}

export type SnapshotFormat = 'memfs-json' | 'cbor';

export interface SnapshotOptions {
  signal?: AbortSignal;
  format?: SnapshotFormat;
  ignore?: readonly RegExp[];
}

export interface RestoreOptions {
  signal?: AbortSignal;
  format?: SnapshotFormat;
  clean?: boolean;
}

export type Snapshot =
  | { format: 'memfs-json'; data: Record<string, string | Uint8Array | null> }
  | { format: 'cbor'; data: Uint8Array };

export type ChangeEvent =
  | { type: 'write'; path: string }
  | { type: 'remove'; path: string };

export interface StorageProvider {
  readonly metadata: ProviderMetadata;
  readonly capabilities: ProviderCapabilities;

  exists(path: string, options?: ReadOptions): Promise<boolean>;
  read(path: string, options?: ReadOptions): Promise<Uint8Array>;
  write(path: string, data: Uint8Array, options?: WriteOptions): Promise<void>;
  remove(path: string, options?: RemoveOptions): Promise<void>;
  list(path: string, options?: ListOptions): Promise<ListEntry[]>;
  stat(path: string, options?: ReadOptions): Promise<FileMeta | null>;

  snapshot(path: string, options?: SnapshotOptions): Promise<Snapshot>;
  restore(
    path: string,
    snapshot: Snapshot,
    options?: RestoreOptions,
  ): Promise<void>;

  subscribe?(path: string, listener: (event: ChangeEvent) => void): () => void;
}

export interface CommitRef {
  oid: string;
  parents: readonly string[];
  message: string;
  author: { name: string; email: string; timestamp: number };
  files: readonly string[];
}

export interface CommitOptions {
  signal?: AbortSignal;
  message: string;
  author?: { name: string; email: string };
}

export interface LogOptions {
  signal?: AbortSignal;
  depth?: number;
  ref?: string;
}

export interface VersionedStorageProvider extends StorageProvider {
  readonly capabilities: ProviderCapabilities & { versioning: true };

  status(
    path: string,
    options?: ReadOptions,
  ): Promise<{
    staged: readonly string[];
    unstaged: readonly string[];
    untracked: readonly string[];
  }>;
  commit(path: string, options: CommitOptions): Promise<CommitRef>;
  log(path: string, options?: LogOptions): Promise<readonly CommitRef[]>;
  diff(
    path: string,
    options?: { from?: string; to?: string; signal?: AbortSignal },
  ): Promise<string>;
}
