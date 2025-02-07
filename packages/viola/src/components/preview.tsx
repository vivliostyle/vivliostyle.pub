import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
    const { port } = window.location;
    setUrl(
      `https://${import.meta.env.VITE_SANDBOX_HOSTNAME}${port ? `:${port}` : ''}`,
    );
  }, []);

  return <>{!failed && url && <iframe title="Preview" src={url} />}</>;
};
