/// <reference lib="webworker" />

import * as Comlink from 'comlink';

self.addEventListener('message', async (event) => {
  if (event.data.command === 'init') {
    const channel = new BroadcastChannel('worker:cli');
    // @ts-expect-error: Check vite.config.ts for the rationale behind this type assertion
    const { default: mod } = (await import('#cli-bundle')) as {
      default: Promise<typeof import('#cli-bundle')>;
    };
    const cli = await mod;
    Comlink.expose(cli, channel);
    self.postMessage({ command: 'init' });
  }
});
