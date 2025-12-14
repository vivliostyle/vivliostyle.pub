import { use, useCallback } from 'react';
import { ref } from 'valtio';

import { $viewer } from '../../stores/viewer';

const PreviewIframe = () => {
  const url = use($viewer.setupServer());

  const iframeRef = useCallback((el: HTMLIFrameElement | null) => {
    if (el) {
      $viewer.iframeElement = ref(el);
    } else if ($viewer.iframeElement) {
      $viewer.iframeElement = undefined;
    }
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="Preview"
      src={url}
      className="size-full"
      sandbox="allow-same-origin allow-scripts allow-modals"
    />
  );
};

export const Preview = () => {
  return <PreviewIframe />;
};
