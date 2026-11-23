import * as Comlink from 'comlink';

import { applyColorScheme } from '../color-scheme';
import {
  isColorScheme,
  isViewMode,
  isZoom,
  type StageController,
  stageBindCommand,
  type ViewMode,
  type Zoom,
} from '../protocol';
import { subscribeFullReload } from './hmr';
import { Stage } from './stage';

export interface PreviewOptions {
  /** Null when there is no publication the stage may load. */
  publicationUrl: string | null;
  viewMode: ViewMode;
  zoom: Zoom;
}

/**
 * Shows the publication, reloads it on every change the in-worker Vite
 * reports, and exposes the {@link StageController} to the embedder that binds.
 */
export function startPreview(
  viewportElement: HTMLElement,
  { publicationUrl, viewMode, zoom }: PreviewOptions,
) {
  const stage = new Stage(viewportElement, viewMode, zoom);

  const controller: StageController = {
    next: () => stage.next(),
    prev: () => stage.prev(),
    goTo: (pageIndex) => stage.goTo(pageIndex),
    setViewMode: (mode) => {
      if (isViewMode(mode)) {
        stage.setViewMode(mode);
      }
    },
    setZoom: (zoom) => {
      if (isZoom(zoom)) {
        stage.setZoom(zoom);
      }
    },
    setColorScheme: (colorScheme) => {
      if (isColorScheme(colorScheme)) {
        applyColorScheme(colorScheme);
      }
    },
    subscribe: (listener) => Comlink.proxy(stage.subscribe(listener)),
  };

  // The embedder binds on the frame's load event, so this listener has to be
  // in place before the entry module finishes evaluating.
  window.addEventListener('message', (event) => {
    if (
      event.source !== window.parent ||
      event.data?.command !== stageBindCommand
    ) {
      return;
    }
    const [port] = event.ports;
    if (port) {
      Comlink.expose(controller, port);
    }
  });

  if (publicationUrl) {
    stage.load(publicationUrl);
  }

  subscribeFullReload((path) => stage.reload(path === '*'));
}
