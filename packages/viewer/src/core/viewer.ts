import {
  CoreViewer,
  type CoreViewerOptions,
  PageViewMode,
  ReadyState,
} from '@vivliostyle/core';

import type { StageStatus } from '../protocol';
import { defaultPaperSize } from './paper-size';

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
  defaultPaperSize: { ...defaultPaperSize },
};

export const stageStatus: Record<ReadyState, StageStatus> = {
  [ReadyState.LOADING]: 'loading',
  [ReadyState.INTERACTIVE]: 'interactive',
  [ReadyState.COMPLETE]: 'complete',
};

export function createCoreViewer(viewportElement: HTMLElement): CoreViewer {
  return new CoreViewer({ viewportElement }, viewerOptions);
}
