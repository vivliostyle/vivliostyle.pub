import type { BuildTask } from '@vivliostyle/cli/schema';
import * as Comlink from 'comlink';
import { proxy, snapshot, subscribe } from 'valtio';

export const sandbox = proxy({
  files: {} as Record<string, string>,
  vivliostyleConfig: {
    title: 'title',
    entry: ['./manuscript.html'],
    entryContext: 'contents',
    theme: ['@vivliostyle/theme-base', './style.css'],
  } satisfies BuildTask as BuildTask,
  customCss: { value: '' },
});

let fulfilledCli: Comlink.Remote<typeof import('#cli-bundle')> | undefined;

export function setCliWorker(cliWorker: typeof fulfilledCli) {
  fulfilledCli?.[Comlink.releaseProxy]();
  fulfilledCli = cliWorker;
  // Write initial files
  cliWorker?.fromJSON({
    '/workdir/vivliostyle.config.json': JSON.stringify(
      sandbox.vivliostyleConfig,
    ),
    '/workdir/style.css': sandbox.customCss.value,
  });
}

export const cliPromise = new Promise<
  Comlink.Remote<typeof import('#cli-bundle')>
>((resolve) => {
  const loop = () => {
    if (fulfilledCli) {
      return resolve(fulfilledCli);
    }
    requestAnimationFrame(loop);
  };
  loop();
});

subscribe(sandbox.files, async () => {
  const cli = await cliPromise;
  const files = snapshot(sandbox.files);
  cli.fromJSON(files, '/workdir/contents');
});

subscribe(sandbox.vivliostyleConfig, async () => {
  const cli = await cliPromise;
  cli.write(
    '/workdir/vivliostyle.config.json',
    JSON.stringify(sandbox.vivliostyleConfig),
  );
});

subscribe(sandbox.customCss, async () => {
  const cli = await cliPromise;
  cli.write('/workdir/style.css', sandbox.customCss.value);
});
