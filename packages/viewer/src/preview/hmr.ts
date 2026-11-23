import type { HotPayload } from 'vite/types/hmrPayload.d.ts';

// The in-worker Vite server of `@v/cli-bundle` posts its HMR payloads here.
const hmrChannelName = 'worker:vite-hmr';

/**
 * Calls `onFullReload` with the changed path on every `full-reload` payload:
 * the changed entry's target for a manuscript edit, `'*'` for a config or
 * project dependency change.
 */
export function subscribeFullReload(
  onFullReload: (path: string) => void,
): () => void {
  const channel = new BroadcastChannel(hmrChannelName);
  channel.addEventListener('message', (event: MessageEvent<HotPayload>) => {
    if (event.data.type === 'full-reload') {
      onFullReload(event.data.path ?? '*');
    }
  });
  return () => channel.close();
}
