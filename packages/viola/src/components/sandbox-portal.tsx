import * as Comlink from 'comlink';
import { invariant } from 'outvariant';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSnapshot } from 'valtio';

import { $sandboxes } from '../stores/accessors';
import type { ProjectId } from '../stores/proxies/project';

declare global {
  interface Window {
    __debug: {
      cli?: Record<string, unknown>;
      themeRegistry?: typeof import('@v/theme-registry');
    };
  }
}
if (import.meta.env.DEV) {
  window.__debug ??= {};
  window.__debug.cli ??= {};
}

function IframeSandbox({ projectId }: { projectId: ProjectId }) {
  const sandbox = useSnapshot($sandboxes).value[projectId];
  invariant(sandbox, 'Sandbox not found: %s', projectId);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const rawSandbox = $sandboxes.value[projectId];
    if (!rawSandbox) return;
    const cliWorkerResolver = rawSandbox.cli.createRemoteResolver();
    let cliResolved = false;
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.command !== 'bind') return;
      const [messagePort] = event.ports;
      if (event.data.channel === 'worker:cli') {
        const cli = Comlink.wrap<typeof import('@v/cli-bundle')>(messagePort);
        if (import.meta.env.DEV && window.__debug.cli) {
          window.__debug.cli[projectId] = cli;
        }
        cliWorkerResolver.resolve(cli);
        cliResolved = true;
      } else if (event.data.channel === 'worker:theme-registry') {
        const themeRegistry = await import('@v/theme-registry');
        if (import.meta.env.DEV) {
          window.__debug.themeRegistry = themeRegistry;
        }
        Comlink.expose(themeRegistry, messagePort);
      }
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (cliResolved) {
        cliWorkerResolver.reset();
        if (import.meta.env.DEV) {
          delete window.__debug.cli?.[projectId];
        }
      }
    };
  }, [projectId]);

  return (
    <iframe
      ref={iframeRef}
      title="Sandbox"
      src={`${sandbox.iframeOrigin}/sandbox`}
      style={{ display: 'none' }}
      sandbox="allow-same-origin allow-scripts"
      allow="cross-origin-isolated"
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
