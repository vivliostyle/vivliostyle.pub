import { useEffect, useRef, useState } from 'react';

import type { ExtensionMountContext } from '@v/viola-extension-kit';
import { m } from '../generated/paraglide/messages';
import { toLocale } from '../locale';

import '@v/viola-extension-kit/styles.css';

export default function PreviewPane({ host, locale }: ExtensionMountContext) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewerLoadedRef = useRef(false);
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

  // Relays host print commands to the nested viewer, which the host can't
  // reach itself. Only answer `print-pdf-query` once the viewer has loaded
  // (`load` implies its message listener is in place).
  useEffect(() => {
    if (!url) return;
    const viewerOrigin = new URL(url).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      switch (event.data?.type) {
        case 'print-pdf-query':
          if (viewerLoadedRef.current) {
            window.parent.postMessage(
              { type: 'print-pdf-ready' },
              event.origin,
            );
          }
          break;
        case 'print-pdf':
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'print-pdf' },
            viewerOrigin,
          );
          break;
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
      title={m.preview_iframe_title({}, { locale: toLocale(locale) })}
      src={url}
      onLoad={() => {
        viewerLoadedRef.current = true;
      }}
      className="block size-full"
      sandbox="allow-same-origin allow-scripts allow-modals"
      allow="cross-origin-isolated"
    />
  );
}
