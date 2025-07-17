import * as Comlink from 'comlink';
import { createPortal } from 'react-dom';

import { createCliWorkerResolver } from '../stores/sandbox';

const port = globalThis.location?.port;
export const sandboxOrigin = `https://${import.meta.env.VITE_SANDBOX_HOSTNAME}${port ? `:${port}` : ''}`;

let initialized = false;

declare global {
  interface Window {
    __debug: {
      cli?: unknown;
      themeRegistry?: typeof import('@v/theme-registry');
    };
  }
}
if (import.meta.env.DEV) {
  window.__debug ??= {};
}

function init(iframe: HTMLIFrameElement) {
  if (initialized) {
    return;
  }
  const cliWorkerResolver = createCliWorkerResolver();
  const cb = async (event: MessageEvent) => {
    if (event.data.command !== 'bind') {
      return;
    }
    const [messagePort] = event.ports;
    if (event.data.channel === 'worker:cli') {
      const cli = Comlink.wrap<typeof import('@v/cli-bundle')>(messagePort);
      if (import.meta.env.DEV) {
        window.__debug.cli = cli;
      }
      cliWorkerResolver.resolve(cli);
    }
    if (event.data.channel === 'worker:theme-registry') {
      const themeRegistry = await import('@v/theme-registry');
      if (import.meta.env.DEV) {
        window.__debug.themeRegistry = themeRegistry;
      }
      Comlink.expose(themeRegistry, messagePort);
    }
  };
  initialized = true;
  window.addEventListener('message', cb);

  const observer = new MutationObserver((mutations) => {
    const removed = mutations
      .flatMap(({ removedNodes }) => Array.from(removedNodes))
      .some((node) => node === iframe);
    if (removed) {
      if (import.meta.env.DEV) {
        window.__debug.cli = undefined;
      }
      cliWorkerResolver.reset();
      initialized = false;
      window.removeEventListener('message', cb);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

export function Sandbox() {
  return createPortal(
    <iframe
      ref={init}
      title="Sandbox"
      src={`${sandboxOrigin}/iframe`}
      style={{ display: 'none' }}
      sandbox="allow-same-origin allow-scripts"
    />,
    document.body,
  );
}
