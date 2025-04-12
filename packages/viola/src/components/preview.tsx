import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const Preview = ({ origin }: { origin: string }) => {
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
      `${origin}/__vivliostyle-viewer/index.html#src=${origin}/vivliostyle/publication.json&bookMode=true&renderAllPages=true`,
    );
  }, [origin]);

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
