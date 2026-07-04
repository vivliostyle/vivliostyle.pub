import { useEffect, useRef, useState } from 'react';

import type { ExtensionMountContext } from '@v/extension-kit';

import '@v/extension-kit/styles.css';

export default function PreviewPane({ host, t }: ExtensionMountContext) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostOriginRef = useRef<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void host.getViewerUrl().then((viewerUrl) => {
      if (!disposed) {
        setUrl(viewerUrl);
      }
    });
    return () => {
      disposed = true;
    };
  }, [host]);

  // Relays print messages between the host and the nested viewer, which can't
  // reach each other directly. Readiness is answered by the viewer itself
  // (cli-bundle's viewer-adapter), the only party that knows when every page
  // has rendered.
  useEffect(() => {
    if (!url) return;
    const viewerOrigin = new URL(url).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.source === window.parent) {
        switch (event.data?.type) {
          case 'print-pdf-query':
          case 'print-pdf':
            hostOriginRef.current = event.origin;
            iframeRef.current?.contentWindow?.postMessage(
              event.data,
              viewerOrigin,
            );
            break;
        }
      } else if (
        event.source === iframeRef.current?.contentWindow &&
        event.origin === viewerOrigin
      ) {
        switch (event.data?.type) {
          case 'print-pdf-ready':
          case 'print-pdf-done':
            if (hostOriginRef.current) {
              window.parent.postMessage(event.data, hostOriginRef.current);
            }
            break;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url]);

  if (!url) {
    return null;
  }

  return (
    <iframe
      ref={iframeRef}
      title={t('preview_iframe_title')}
      src={url}
      className="block size-full"
      sandbox="allow-same-origin allow-scripts allow-modals"
      allow="cross-origin-isolated"
    />
  );
}
