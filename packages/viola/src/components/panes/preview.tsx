import { use, useCallback, useEffect, useRef } from 'react';
import { ref } from 'valtio';

import { $viewer } from '../../stores/viewer';

const PreviewIframe = () => {
  const url = use($viewer.setupServer());
  const elementRef = useRef<HTMLIFrameElement | null>(null);

  const iframeRef = useCallback((el: HTMLIFrameElement | null) => {
    elementRef.current = el;
    if (el) {
      $viewer.iframeElement = ref(el);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (elementRef.current && $viewer.iframeElement === elementRef.current) {
        $viewer.iframeElement = undefined;
      }
    };
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
