import { useEffect, useState } from 'react';

import type { ExtensionMountContext } from '@v/extension-kit';

import '@v/extension-kit/styles.css';

export default function PreviewPane({ host, t }: ExtensionMountContext) {
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

  if (!url) {
    return null;
  }

  return (
    <iframe
      title={t('preview_iframe_title')}
      src={url}
      className="block size-full"
      sandbox="allow-same-origin allow-scripts allow-modals"
      allow="cross-origin-isolated"
    />
  );
}
