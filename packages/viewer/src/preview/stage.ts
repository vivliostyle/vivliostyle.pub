import { type CoreViewer, PageProgression } from '@vivliostyle/core';

import { CommandGate } from '../core/command-gate';
import { dropFontCache, viewFontStyles } from '../core/font-cache';
import { defaultPaperSize } from '../core/paper-size';
import { pagesAwaitingTargets } from '../core/references';
import { createCoreViewer, stageStatus } from '../core/viewer';
import {
  clampZoomScale,
  type StageState,
  type StageStateListener,
  type ViewMode,
  type Zoom,
} from '../protocol';
import { Presentation, type PresentationSnapshot } from './presentation';
import { ReloadController, reloadFailed, reloadStatus } from './reload';

export class Stage {
  readonly #viewer: CoreViewer;
  readonly #gate: CommandGate;
  readonly #reload: ReloadController;
  readonly #presentation: Presentation;
  readonly #listeners = new Set<StageStateListener>();
  #publicationUrl: string | undefined;
  #state: StageState;
  /**
   * The font rules core used before a hard reload dropped its font cache,
   * kept while pages laid out before it are shown.
   */
  #replacedFontStyles: {
    styles: HTMLStyleElement[];
    liveGeneration: number;
  } | null = null;

  constructor(viewportElement: HTMLElement, viewMode: ViewMode, zoom: Zoom) {
    this.#viewer = createCoreViewer(viewportElement);
    this.#gate = new CommandGate(this.#viewer);
    zoom = clampZoom(zoom);
    this.#state = {
      status: 'loading',
      failed: false,
      viewMode,
      zoom,
      scale: typeof zoom === 'number' ? zoom : 1,
      pageProgression: 'ltr',
      pageIndex: 0,
      pageCount: 0,
      canPrev: false,
      canNext: false,
    };
    this.#reload = new ReloadController({
      gate: this.#gate,
      load: (hard) => this.#load(hard),
      onChange: (state) => {
        const failed = reloadFailed(state);
        const failedChanged = failed !== this.#state.failed;
        this.#update({ status: reloadStatus(state), failed });
        // Last: the presentation may report back to the controller.
        if (failedChanged) {
          this.#presentation.setLayoutFailed(failed);
        }
      },
    });
    this.#presentation = new Presentation(viewportElement, {
      viewMode,
      zoom,
      fallbackPageSize: defaultPaperSize,
      pageProgression: () => {
        const progression = this.#viewer.getCurrentPageProgression();
        return progression === null
          ? null
          : progression === PageProgression.RTL
            ? 'rtl'
            : 'ltr';
      },
      onChange: (snapshot) => this.#onPresentationChange(snapshot),
      onProgress: () => this.#reload.dispatch({ type: 'progress' }),
      onLayoutStart: () => this.#reload.dispatch({ type: 'layoutStart' }),
      onShown: () => this.#reload.dispatch({ type: 'shown' }),
      pagesAwaitingTargets: () => pagesAwaitingTargets(this.#viewer),
    });
    this.#viewer.addListener('readystatechange', () => {
      const status = stageStatus[this.#viewer.readyState];
      this.#presentation.setComplete(status === 'complete');
      this.#reload.dispatch({ type: 'status', status });
    });
    this.#viewer.addListener('error', () => {
      this.#reload.dispatch({ type: 'error' });
    });
  }

  load(publicationUrl: string) {
    this.#publicationUrl = publicationUrl;
    this.#reload.dispatch({ type: 'request', hard: false });
  }

  /**
   * Lays the publication out anew from its current files. `hard` also makes
   * core load its fonts anew, for a change of the configuration or of what
   * the project depends on.
   */
  reload(hard: boolean) {
    if (this.#publicationUrl) {
      this.#reload.dispatch({ type: 'request', hard });
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

  setZoom(zoom: Zoom) {
    const clamped = clampZoom(zoom);
    this.#presentation.setZoom(clamped);
    this.#update({ zoom: clamped });
  }

  subscribe(listener: StageStateListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #load(hard: boolean) {
    const publicationUrl = this.#publicationUrl;
    if (!publicationUrl) {
      throw new Error('No publication to load');
    }
    if (hard) {
      const styles = viewFontStyles(document);
      if (dropFontCache(this.#viewer)) {
        this.#replacedFontStyles = {
          styles,
          liveGeneration: this.#presentation.liveGeneration,
        };
      }
    }
    this.#viewer.loadPublication(publicationUrl);
  }

  #onPresentationChange(snapshot: PresentationSnapshot) {
    this.#update(snapshot);
    // Pages core laid out after it dropped the font cache use fonts of their
    // own, so the earlier rules are unused once no earlier page can be shown.
    const replaced = this.#replacedFontStyles;
    if (
      replaced &&
      !this.#presentation.holdsOutdatedPages &&
      this.#presentation.liveGeneration > replaced.liveGeneration
    ) {
      for (const style of replaced.styles) {
        style.remove();
      }
      this.#replacedFontStyles = null;
    }
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

function clampZoom(zoom: Zoom): Zoom {
  return typeof zoom === 'number' ? clampZoomScale(zoom) : zoom;
}
