import * as Comlink from 'comlink';
import { invariant } from 'outvariant';
import { createPortal } from 'react-dom';
import { useSnapshot } from 'valtio';

import { $sandboxes } from '../stores/accessors';
import type { ProjectId } from '../stores/proxies/project';

const initializedMap: Map<ProjectId, boolean> = new Map();

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

function init(iframe: HTMLIFrameElement, projectId: ProjectId) {
  const sandbox = $sandboxes.value[projectId];
  invariant(sandbox, 'Sandbox not found: %s', projectId);
  if (initializedMap.get(projectId)) {
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
  initializedMap.set(projectId, true);
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
      initializedMap.delete(projectId);
      window.removeEventListener('message', cb);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

function IframeSandbox({ projectId }: { projectId: ProjectId }) {
  const sandbox = useSnapshot($sandboxes).value[projectId];
  invariant(sandbox, 'Sandbox not found: %s', projectId);

  return (
    <iframe
      ref={(el) => init(el as HTMLIFrameElement, projectId)}
      title="Sandbox"
      src={`${sandbox.iframeOrigin}/sandbox`}
      style={{ display: 'none' }}
      sandbox="allow-same-origin allow-scripts"
    />
  );
}

export function SandboxPortal() {
  const sandboxes = useSnapshot($sandboxes);

  return createPortal(
    Object.keys(sandboxes.value).map((projectId) => (
      <IframeSandbox key={projectId} projectId={projectId as ProjectId} />
    )),
    document.body,
  );
}
