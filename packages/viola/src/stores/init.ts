import { subscribe, unstable_enableOp } from 'valtio';

import { startProjectRelay } from '../client/project-relay';
import {
  loadViewerPaperSize,
  saveViewerPaperSize,
} from '../libs/viewer-paper-size';
import { viewer } from './proxies/viewer';

export function initStores(): () => void {
  // valtio 2.2+ requires opting into op delivery for `subscribe` callbacks;
  // `Sandbox` reads the ops to mirror file changes into storage and the CLI
  // worker's memfs.
  unstable_enableOp();
  const stopProjectRelay = startProjectRelay();
  // Restored so that printing before the preview is shown again still uses
  // the paper size the preview showed last.
  viewer.paperSize = loadViewerPaperSize();
  const stopSavingPaperSize = subscribe(viewer, () =>
    saveViewerPaperSize(viewer.paperSize),
  );
  return () => {
    stopSavingPaperSize();
    stopProjectRelay();
    unstable_enableOp(false);
  };
}
