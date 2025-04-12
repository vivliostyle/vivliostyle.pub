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

export const cli = proxy({
  worker: null as Remote<CliWorkerEndpoint> | null,
  files: {} as Record<string, string>,
});

subscribe(cli, () => {
  const files = snapshot(cli.files);
  cli.worker?.fromJSON(files, '/workdir/contents');
});

export async function setupCli() {
  const { worker } = snapshot(cli);
  if (!worker) {
    return;
  }
  await worker.write(
    '/workdir/vivliostyle.config.json',
    JSON.stringify({
      title: 'title',
      entry: ['./manuscript.html'],
      entryContext: 'contents',
      theme: '@vivliostyle/theme-techbook',
    }),
  );
  cli.files = { 'manuscript.html': '' };
  await worker.setupServer();
}
