import * as Comlink from 'comlink';
import { type RefObject, useEffect, useState } from 'react';

import {
  type StageController,
  type StageState,
  stageBindCommand,
} from '@v/viewer/protocol';

/** The stage's commands, fired without waiting for the stage to act. */
export type StageCommands = {
  [K in Exclude<keyof StageController, 'subscribe'>]: (
    ...args: Parameters<StageController[K]>
  ) => void;
};

// Binds anew on every load of the frame, since a new stage document has to be
// handed a new port.
export function useStage(
  frameRef: RefObject<HTMLIFrameElement | null>,
  url: string,
  frameLoadCount: number,
) {
  const [stage, setStage] = useState<StageCommands | null>(null);
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
    const remote = Comlink.wrap<StageController>(port1);
    setStage({
      next: () => void remote.next(),
      prev: () => void remote.prev(),
      goTo: (pageIndex) => void remote.goTo(pageIndex),
      setViewMode: (viewMode) => void remote.setViewMode(viewMode),
      setDefaultPaperSize: (paperSize) =>
        void remote.setDefaultPaperSize(paperSize),
    });

    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void remote
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
      remote[Comlink.releaseProxy]();
    };
  }, [frameRef, url, frameLoadCount]);

  return { stage, state };
}
