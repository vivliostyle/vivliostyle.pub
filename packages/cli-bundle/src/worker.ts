/// <reference lib="webworker" />

import './volume';

import * as Comlink from 'comlink';
import * as api from '.';

self.addEventListener('message', async (event) => {
  if (event.data.command === 'init') {
    const channel = new BroadcastChannel('worker:cli');
    Comlink.expose(api, channel);
    self.postMessage({ command: 'init' });
  }
});
