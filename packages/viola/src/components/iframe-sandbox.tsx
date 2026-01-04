import * as Comlink from 'comlink';
import { use } from 'react';
import { createPortal } from 'react-dom';
import { useSnapshot } from 'valtio';

import { $project } from '../stores/accessors';
import type { Sandbox } from '../stores/proxies/sandbox';

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

function init(iframe: HTMLIFrameElement, sandbox: Sandbox) {
  if (initialized) {
    return;
  }
  const cliWorkerResolver = sandbox.cli.createRemoteResolver();
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

export function IframeSandbox() {
  const project = useSnapshot($project).valueOrThrow;
  const sandbox = use(project.sandboxPromise);

  return createPortal(
    <iframe
      ref={(el) => init(el as HTMLIFrameElement, sandbox)}
      title="Sandbox"
      src={`${sandbox.iframeOrigin}/sandbox`}
      style={{ display: 'none' }}
      sandbox="allow-same-origin allow-scripts"
    />,
    document.body,
  );
}
