import {
  CoreViewer,
  type CoreViewerOptions,
  Navigation,
  PageViewMode,
  ReadyState,
} from '@vivliostyle/core';

import type { StageState, StageStateListener, StageStatus } from './protocol';

const a4PaperSize = { width: 794, height: 1123 };

const viewerOptions: CoreViewerOptions = {
  pageViewMode: PageViewMode.SINGLE_PAGE,
  renderAllPages: true,
  // Pagination must never depend on the pane size, so the paper size is fixed
  // and a resize never re-lays out.
  autoResize: false,
  fitToScreen: false,
  zoom: 1,
  defaultPaperSize: a4PaperSize,
};

const stageStatus: Record<ReadyState, StageStatus> = {
  [ReadyState.LOADING]: 'loading',
  [ReadyState.INTERACTIVE]: 'interactive',
  [ReadyState.COMPLETE]: 'complete',
};

export class Stage {
  readonly #viewer: CoreViewer;
  readonly #listeners = new Set<StageStateListener>();
  #publicationUrl: string | undefined;
  #state: StageState = { status: 'loading', pageIndex: 0, pageCount: 0 };
  #hasPages = false;

  constructor(viewportElement: HTMLElement) {
    this.#viewer = new CoreViewer({ viewportElement }, viewerOptions);
    this.#viewer.addListener('readystatechange', () => {
      const status = stageStatus[this.#viewer.readyState];
      if (status !== 'loading') {
        this.#hasPages = true;
      }
      this.#update({ status });
    });
    this.#viewer.addListener('nav', ({ epage, epageCount }) => {
      this.#update({
        pageIndex: typeof epage === 'number' ? epage : this.#state.pageIndex,
        pageCount:
          typeof epageCount === 'number' ? epageCount : this.#state.pageCount,
      });
    });
  }

  load(publicationUrl: string) {
    this.#publicationUrl = publicationUrl;
    this.#viewer.loadPublication(publicationUrl);
  }

  reload() {
    if (this.#publicationUrl) {
      this.#viewer.loadPublication(this.#publicationUrl);
    }
  }

  // Core navigates through a page view that its first layout creates, and
  // throws when asked to navigate before that.
  next() {
    if (this.#hasPages) {
      this.#viewer.navigateToPage(Navigation.NEXT);
    }
  }

  prev() {
    if (this.#hasPages) {
      this.#viewer.navigateToPage(Navigation.PREVIOUS);
    }
  }

  subscribe(listener: StageStateListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #update(patch: Partial<StageState>) {
    const next = { ...this.#state, ...patch };
    if (
      next.status === this.#state.status &&
      next.pageIndex === this.#state.pageIndex &&
      next.pageCount === this.#state.pageCount
    ) {
      return;
    }
    this.#state = next;
    for (const listener of this.#listeners) {
      listener(next);
    }
  }
}
