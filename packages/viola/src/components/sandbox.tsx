import * as Comlink from 'comlink';
import { createPortal } from 'react-dom';
import { useEffectOnce, useUnmount } from 'react-use';
import * as themeRegistry from '#theme-registry';
import { setupCli } from '../actions';
import { sandbox } from '../stores/sandbox';

const port = globalThis.location?.port;
export const sandboxOrigin = `https://${import.meta.env.VITE_SANDBOX_HOSTNAME}${port ? `:${port}` : ''}`;

let initialized = false;

declare global {
  interface Window {
    __debug: {
      cli?: unknown;
      themeRegistry?: typeof themeRegistry;
    };
  }
}
if (import.meta.env.DEV) {
  window.__debug ??= {};
}

function init() {
  const cb = async (event: MessageEvent) => {
    if (event.data.command !== 'bind') {
      return;
    }
    const [messagePort] = event.ports;
    if (event.data.channel === 'worker:cli') {
      const cli = Comlink.wrap<typeof import('#cli-bundle')>(messagePort);
      sandbox.worker = cli;
      if (import.meta.env.DEV) {
        window.__debug.cli = cli;
      }
      setupCli();
    }
    if (event.data.channel === 'worker:theme-registry') {
      if (import.meta.env.DEV) {
        window.__debug.themeRegistry = themeRegistry;
      }
      Comlink.expose(themeRegistry, messagePort);
    }
  };
  initialized = true;
  window.addEventListener('message', cb);

  return () => {
    initialized = false;
    window.removeEventListener('message', cb);
  };
}

export function Sandbox() {
  useEffectOnce(() => {
    if (initialized) {
      return;
    }
    return init();
  });

  useUnmount(() => {
    initialized = false;
    sandbox.worker?.[Comlink.releaseProxy]();
    sandbox.worker = null;
  });

  return createPortal(
    <iframe
      title="Sandbox"
      src={`${sandboxOrigin}/iframe`}
      style={{ display: 'none' }}
      sandbox="allow-same-origin allow-scripts"
    />,
    document.body,
  );
}
