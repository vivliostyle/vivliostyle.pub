import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sandboxOrigin } from '../sandbox';

export const Preview = () => {
  const retry = useRef(0);
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState<string>();

  useLayoutEffect(() => {
    const cb = (event: MessageEvent) => {
      if (event.data?.command === 'retry') {
        if (retry.current >= 3) {
          setFailed(true);
        }
        retry.current += 1;
      }
    };
    window.addEventListener('message', cb);
    return () => {
      window.removeEventListener('message', cb);
    };
  }, []);

  useEffect(() => {
    setUrl(
      `${sandboxOrigin}/__vivliostyle-viewer/index.html#src=${sandboxOrigin}/vivliostyle/publication.json&bookMode=true&renderAllPages=true`,
    );
  }, []);

  return (
    <>
      {!failed && url && (
        <iframe
          title="Preview"
          src={url}
          className="size-full"
          sandbox="allow-same-origin allow-scripts"
        />
      )}
    </>
  );
};
