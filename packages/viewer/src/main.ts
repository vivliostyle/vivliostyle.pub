import * as Comlink from 'comlink';

import { subscribeFullReload } from './hmr';
import { printPublication } from './print';
import { defaultPrintLocale, isPrintLocale } from './print-messages';
import {
  defaultPaperSize,
  defaultViewMode,
  isPaperSize,
  isViewMode,
  type PaperSize,
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
const paperSizeParam = searchParams.get(stageSearchParams.paperSize);
const paperSize = isPaperSize(paperSizeParam)
  ? paperSizeParam
  : defaultPaperSize;

function publicationUrlFrom(src: string | null): string | null {
  if (!src) {
    return null;
  }
  const publicationUrl = new URL(src, location.href);
  // Document scripts run in this window with this origin's privileges.
  if (publicationUrl.origin !== location.origin) {
    console.error(
      `Refusing to load a cross-origin publication: ${publicationUrl.href}`,
    );
    return null;
  }
  return publicationUrl.href;
}

function startPreview(
  viewport: HTMLElement,
  publicationUrl: string | null,
  initialPaperSize: PaperSize,
) {
  const viewMode = searchParams.get(stageSearchParams.viewMode);
  const stage = new Stage(viewport, {
    viewMode: isViewMode(viewMode) ? viewMode : defaultViewMode,
    paperSize: initialPaperSize,
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

  // The embedder binds on the frame's load event, so this listener has to be
  // in place before this module finishes evaluating.
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

const publicationUrl = publicationUrlFrom(
  searchParams.get(stageSearchParams.src),
);
if (searchParams.get(stageSearchParams.print) === 'true') {
  const locale = searchParams.get(stageSearchParams.locale);
  printPublication(viewportElement, {
    publicationUrl,
    paperSize,
    locale: isPrintLocale(locale) ? locale : defaultPrintLocale,
  });
} else {
  startPreview(viewportElement, publicationUrl, paperSize);
}
