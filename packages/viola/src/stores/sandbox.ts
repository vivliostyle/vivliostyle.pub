import type { Remote } from 'comlink';
import { proxy, snapshot, subscribe } from 'valtio';

type DirectoryContent = string | Buffer | null;

interface DirectoryJSON<T extends DirectoryContent = DirectoryContent> {
  [key: string]: T;
}

export interface CliWorkerEndpoint {
  setupServer: () => Promise<void>;
  build: () => Promise<void>;
  read: typeof import('node:fs/promises')['readFile'];
  write: typeof import('node:fs/promises')['writeFile'];
  fromJSON(json: DirectoryJSON, cwd?: string): void;
  toJSON(
    paths?: string | string[],
    json?: object,
    isRelative?: boolean,
    asBuffer?: boolean,
  ): DirectoryJSON<string | null>;
}

export const sandbox = proxy({
  worker: null as Remote<CliWorkerEndpoint> | null,
  files: {} as Record<string, string>,
});

subscribe(sandbox, () => {
  const files = snapshot(sandbox.files);
  sandbox.worker?.fromJSON(files, '/workdir/contents');
});
