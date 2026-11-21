import * as Comlink from 'comlink';
import { type RefObject, useEffect, useRef, useState } from 'react';

import type {
  ExtensionMountContext,
  ExtensionTranslate,
} from '@v/extension-kit';
import { Button } from '@v/ui/button';
import { ChevronLeft, ChevronRight, Loader2 } from '@v/ui/icon';
import {
  type StageController,
  type StageState,
  stageBindCommand,
} from '@v/viewer/protocol';

import '@v/extension-kit/styles.css';

type StageNavigation = Pick<StageController, 'next' | 'prev'>;

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

  return <Preview url={url} t={t} />;
}

function Preview({ url, t }: { url: string; t: ExtensionTranslate }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameLoadCount, setFrameLoadCount] = useState(0);
  const { navigation, state } = useStage(frameRef, url, frameLoadCount);

  return (
    <div className="flex size-full flex-col">
      <Toolbar navigation={navigation} state={state} t={t} />
      <iframe
        ref={frameRef}
        title={t('preview_iframe_title')}
        src={url}
        onLoad={() => setFrameLoadCount((count) => count + 1)}
        className="block min-h-0 w-full flex-1"
        sandbox="allow-same-origin allow-scripts allow-modals"
        allow="cross-origin-isolated"
      />
    </div>
  );
}

// Binds anew on every load of the frame, since a new stage document has to be
// handed a new port.
function useStage(
  frameRef: RefObject<HTMLIFrameElement | null>,
  url: string,
  frameLoadCount: number,
) {
  const [navigation, setNavigation] = useState<StageNavigation | null>(null);
  const [state, setState] = useState<StageState | null>(null);

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (frameLoadCount === 0 || !frameWindow) {
      return;
    }
    const { port1, port2 } = new MessageChannel();
    frameWindow.postMessage(
      { command: stageBindCommand },
      new URL(url).origin,
      [port2],
    );
    const stage = Comlink.wrap<StageController>(port1);
    setNavigation({
      next: () => void stage.next(),
      prev: () => void stage.prev(),
    });

    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void stage
      .subscribe(Comlink.proxy((next: StageState) => setState(next)))
      .then((unsub) => {
        if (disposed) {
          void unsub();
        } else {
          unsubscribe = unsub;
        }
      });
    return () => {
      disposed = true;
      void unsubscribe?.();
      stage[Comlink.releaseProxy]();
    };
  }, [frameRef, url, frameLoadCount]);

  return { navigation, state };
}

function Toolbar({
  navigation,
  state,
  t,
}: {
  navigation: StageNavigation | null;
  state: StageState | null;
  t: ExtensionTranslate;
}) {
  const pageCount = state?.pageCount ?? 0;
  const pageIndex = state?.pageIndex ?? 0;
  const complete = state?.status === 'complete';

  return (
    <div className="flex h-10 shrink-0 items-center justify-center gap-1 border-b px-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('preview_prev_page_aria')}
        disabled={!navigation || pageCount === 0 || pageIndex === 0}
        onClick={() => navigation?.prev()}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-16 text-center text-sm tabular-nums">
        {pageCount > 0 ? `${pageIndex + 1} / ${pageCount}` : '-'}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('preview_next_page_aria')}
        disabled={
          !navigation ||
          pageCount === 0 ||
          (complete && pageIndex >= pageCount - 1)
        }
        onClick={() => navigation?.next()}
      >
        <ChevronRight />
      </Button>
      <span className="grid size-4 place-items-center">
        {state && !complete && (
          <Loader2
            role="img"
            aria-label={t('preview_rendering_aria')}
            className="size-4 animate-spin text-muted-foreground"
          />
        )}
      </span>
    </div>
  );
}
