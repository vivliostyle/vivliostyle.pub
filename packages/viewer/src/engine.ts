import {
  CoreViewer,
  type CoreViewerOptions,
  PageViewMode,
  ReadyState,
} from '@vivliostyle/core';

import { paperSizeToPx } from './paper-size';
import type { PaperSize, StageStatus } from './protocol';

const viewerOptions: CoreViewerOptions = {
  // View modes are ours (see `Presentation`): core re-lays out everything
  // when its own page view mode changes.
  pageViewMode: PageViewMode.SINGLE_PAGE,
  renderAllPages: true,
  // Pagination must never depend on the pane size, so the paper size is fixed
  // and a resize never re-lays out.
  autoResize: false,
  fitToScreen: false,
  zoom: 1,
};

export const stageStatus: Record<ReadyState, StageStatus> = {
  [ReadyState.LOADING]: 'loading',
  [ReadyState.INTERACTIVE]: 'interactive',
  [ReadyState.COMPLETE]: 'complete',
};

export function createCoreViewer(
  viewportElement: HTMLElement,
  paperSize: PaperSize,
): CoreViewer {
  // Given up front, the paper size is in effect from the first layout on; a
  // configure command would lay everything out a second time.
  return new CoreViewer(
    { viewportElement },
    { ...viewerOptions, defaultPaperSize: paperSizeToPx(paperSize) },
  );
}
