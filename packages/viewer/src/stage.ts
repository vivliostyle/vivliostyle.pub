import {
  CoreViewer,
  type CoreViewerOptions,
  PageProgression,
  PageViewMode,
  ReadyState,
} from '@vivliostyle/core';

import { CommandGate } from './command-gate';
import { paperSizeToPx } from './paper-size';
import { Presentation, type PresentationSnapshot } from './presentation';
import type {
  PaperSize,
  StageState,
  StageStateListener,
  StageStatus,
  ViewMode,
} from './protocol';

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

const stageStatus: Record<ReadyState, StageStatus> = {
  [ReadyState.LOADING]: 'loading',
  [ReadyState.INTERACTIVE]: 'interactive',
  [ReadyState.COMPLETE]: 'complete',
};

export interface StageOptions {
  viewMode: ViewMode;
  paperSize: PaperSize;
}

export class Stage {
  readonly #viewer: CoreViewer;
  readonly #gate: CommandGate;
  readonly #presentation: Presentation;
  readonly #listeners = new Set<StageStateListener>();
  #publicationUrl: string | undefined;
  #state: StageState;

  constructor(
    viewportElement: HTMLElement,
    { viewMode, paperSize }: StageOptions,
  ) {
    // Given up front, the stored paper size is in effect from the first
    // layout on; a configure command would lay everything out a second time.
    this.#viewer = new CoreViewer(
      { viewportElement },
      { ...viewerOptions, defaultPaperSize: paperSizeToPx(paperSize) },
    );
    this.#gate = new CommandGate(this.#viewer);
    this.#state = {
      status: 'loading',
      viewMode,
      paperSize,
      pageProgression: 'ltr',
      pageIndex: 0,
      pageCount: 0,
      canPrev: false,
      canNext: false,
    };
    this.#presentation = new Presentation(viewportElement, {
      viewMode,
      fallbackPageSize: () => paperSizeToPx(this.#state.paperSize),
      pageProgression: () => {
        const progression = this.#viewer.getCurrentPageProgression();
        return progression === null
          ? null
          : progression === PageProgression.RTL
            ? 'rtl'
            : 'ltr';
      },
      onChange: (snapshot: PresentationSnapshot) => this.#update(snapshot),
    });
    this.#viewer.addListener('readystatechange', () => {
      const status = stageStatus[this.#viewer.readyState];
      this.#presentation.setComplete(status === 'complete');
      this.#update({ status });
    });
  }

  load(publicationUrl: string) {
    this.#publicationUrl = publicationUrl;
    this.reload();
  }

  reload() {
    const publicationUrl = this.#publicationUrl;
    if (publicationUrl) {
      void this.#gate.run(
        'loadPublication',
        () => this.#viewer.loadPublication(publicationUrl),
        { key: 'load' },
      );
    }
  }

  next() {
    this.#presentation.move('next');
  }

  prev() {
    this.#presentation.move('prev');
  }

  goTo(pageIndex: number) {
    this.#presentation.goTo(pageIndex);
  }

  setViewMode(viewMode: ViewMode) {
    this.#presentation.setViewMode(viewMode);
    this.#update({ viewMode });
  }

  setDefaultPaperSize(paperSize: PaperSize) {
    if (paperSize === this.#state.paperSize) {
      return;
    }
    this.#update({ paperSize });
    const configure = () =>
      this.#viewer.setOptions({
        defaultPaperSize: paperSizeToPx(this.#state.paperSize),
      });
    if (this.#publicationUrl) {
      void this.#gate.run('configure', configure, { key: 'paperSize' });
    } else {
      // Core has no command loop before its first load, so no `done` would
      // release the gate; it records the option for that load instead.
      configure();
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
      (Object.keys(next) as (keyof StageState)[]).every(
        (key) => next[key] === this.#state[key],
      )
    ) {
      return;
    }
    this.#state = next;
    for (const listener of this.#listeners) {
      listener(next);
    }
  }
}
