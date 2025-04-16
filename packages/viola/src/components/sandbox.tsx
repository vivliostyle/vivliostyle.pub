import * as Comlink from 'comlink';
import { createPortal } from 'react-dom';
import { useEffectOnce, useUnmount } from 'react-use';
import { setupCli } from '../actions';
import { sandbox } from '../stores/sandbox';

const port = globalThis.location?.port;
export const sandboxOrigin = `https://${import.meta.env.VITE_SANDBOX_HOSTNAME}${port ? `:${port}` : ''}`;

let initialized = false;

function init() {
  const cb = async (event: MessageEvent) => {
    if (event.data.command !== 'bind') {
      return;
    }
    const [messagePort] = event.ports;
    if (event.data.channel === 'worker:cli') {
      sandbox.worker = Comlink.wrap(messagePort);
      setupCli();
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
