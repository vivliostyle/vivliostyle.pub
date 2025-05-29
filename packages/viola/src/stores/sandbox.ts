import type { Remote } from 'comlink';
import { proxy, snapshot, subscribe } from 'valtio';
import type * as cli from '#cli-bundle';

export const sandbox = proxy({
  worker: null as Remote<typeof cli> | null,
  theme: '@vivliostyle/theme-base',
  files: {} as Record<string, string>,
});

subscribe(sandbox, () => {
  const files = snapshot(sandbox.files);
  sandbox.worker?.fromJSON(files, '/workdir/contents');
});
