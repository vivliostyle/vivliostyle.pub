import * as Comlink from 'comlink';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useEffectOnce, useUnmount } from 'react-use';
import { SidebarProvider, SidebarTrigger } from '#ui/sidebar';
import { Editor } from '../components/editor';
import { cli, setupCli } from '../stores/cli';
import { Preview } from './preview';
import { SideMenu } from './side-menu';

const port = globalThis.location?.port;
const sandboxOrigin = `https://${import.meta.env.VITE_SANDBOX_HOSTNAME}${port ? `:${port}` : ''}`;

let initialized = false;

function init() {
  const cb = async (event: MessageEvent) => {
    if (event.data.command !== 'bind') {
      return;
    }
    const [messagePort] = event.ports;
    if (event.data.channel === 'worker:cli') {
      cli.worker = Comlink.wrap(messagePort);
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

function IframePortal() {
  useEffectOnce(() => {
    if (initialized) {
      return;
    }
    return init();
  });

  useUnmount(() => {
    initialized = false;
    cli.worker?.[Comlink.releaseProxy]();
    cli.worker = null;
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

export function Layout() {
  const [openPreview, setOpenPreview] = useState(false);

  return (
    <SidebarProvider>
      <SideMenu />
      <main className="relative size-full">
        <div className="absolute top-0 left-0 z-10 p-2">
          <SidebarTrigger className="size-8 cursor-pointer" />
        </div>
        <div className="size-full max-w-xl mx-auto">
          <div>
            <button type="button" onClick={() => setOpenPreview(true)}>
              Open
            </button>
          </div>
          <Editor />
        </div>
        {openPreview && (
          <div className="h-full">
            <Preview origin={sandboxOrigin} />
          </div>
        )}
      </main>
      <IframePortal />
    </SidebarProvider>
  );
}
