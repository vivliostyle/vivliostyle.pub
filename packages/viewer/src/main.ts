import * as Comlink from 'comlink';

import { subscribeFullReload } from './hmr';
import {
  defaultPaperSize,
  defaultViewMode,
  isPaperSize,
  isViewMode,
  type StageController,
  stageBindCommand,
  stageSearchParams,
} from './protocol';
import { Stage } from './stage';

const viewportElement = document.getElementById('vivliostyle-viewer-viewport');
if (!viewportElement) {
  throw new Error('Viewport element is missing');
}
const searchParams = new URLSearchParams(location.search);
const viewMode = searchParams.get(stageSearchParams.viewMode);
const paperSize = searchParams.get(stageSearchParams.paperSize);
const stage = new Stage(viewportElement, {
  viewMode: isViewMode(viewMode) ? viewMode : defaultViewMode,
  paperSize: isPaperSize(paperSize) ? paperSize : defaultPaperSize,
});

const controller: StageController = {
  next: () => stage.next(),
  prev: () => stage.prev(),
  goTo: (pageIndex) => stage.goTo(pageIndex),
  setViewMode: (mode) => {
    if (isViewMode(mode)) {
      stage.setViewMode(mode);
    }
  },
  setDefaultPaperSize: (size) => {
    if (isPaperSize(size)) {
      stage.setDefaultPaperSize(size);
    }
  },
  subscribe: (listener) => Comlink.proxy(stage.subscribe(listener)),
};

// The embedder binds on the frame's load event, so this listener has to be in
// place before this module finishes evaluating.
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

const src = searchParams.get(stageSearchParams.src);
if (src) {
  const publicationUrl = new URL(src, location.href);
  // Document scripts run in this window with this origin's privileges.
  if (publicationUrl.origin === location.origin) {
    stage.load(publicationUrl.href);
  } else {
    console.error(
      `Refusing to load a cross-origin publication: ${publicationUrl.href}`,
    );
  }
}

subscribeFullReload((path) => stage.reload(path === '*'));
