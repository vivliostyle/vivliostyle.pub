import { ReadyState } from '@vivliostyle/core';

import { createCoreViewer } from './engine';
import {
  isPrintSettled,
  type PrintEffect,
  type PrintEvent,
  type PrintPhase,
  reducePrint,
} from './print-flow';
import { type PrintLocale, printMessages } from './print-messages';
import type { PaperSize } from './protocol';

const spreadContainerSelector =
  ':scope > [data-vivliostyle-outer-zoom-box] > [data-vivliostyle-spread-container]';
const titleProperty = 'http://purl.org/dc/terms/title';

export interface PrintOptions {
  /** Null when there is no publication the stage may load. */
  publicationUrl: string | null;
  paperSize: PaperSize;
  locale: PrintLocale;
}

/**
 * Lays the publication out once, opens the print dialog as soon as every page
 * is laid out, then closes the tab. Nothing embeds the tab, and none of the
 * preview's presentation runs in it: in print media only core's own rules
 * apply to the pages.
 */
export function printPublication(
  viewportElement: HTMLElement,
  { publicationUrl, paperSize, locale }: PrintOptions,
) {
  const stageTitle = document.title;
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.lang = locale;
  document.body.append(status);
  const showStatus = (phase: Exclude<PrintPhase, 'printing'>) => {
    const message = printMessages[locale][phase];
    status.setAttribute('data-pub-print-status', phase);
    status.textContent = message;
    document.title = message;
  };

  if (!publicationUrl) {
    showStatus('failed');
    return;
  }

  const viewer = createCoreViewer(viewportElement, paperSize);
  let phase: PrintPhase = 'preparing';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let spreadContainer: Element | null = null;
  const pageObserver = new MutationObserver(() => {
    dispatch({ type: 'progress' });
  });
  const viewportObserver = new MutationObserver(() => {
    const current = viewportElement.querySelector(spreadContainerSelector);
    if (current !== spreadContainer) {
      spreadContainer = current;
      pageObserver.disconnect();
      if (current) {
        pageObserver.observe(current, { childList: true });
      }
    }
    dispatch({ type: 'progress' });
  });

  const print = () => {
    // Browsers name a PDF saved from the dialog after the document title.
    document.title = viewer.getMetadata()[titleProperty]?.[0]?.v || stageTitle;
    status.remove();
    window.print();
    // `print()` returns once the dialog is closed. Script may close the tab
    // because the host opened it with `window.open`.
    window.close();
  };

  const run = (effect: PrintEffect) => {
    switch (effect.type) {
      case 'watch':
        clearTimeout(timer);
        timer = setTimeout(() => dispatch({ type: 'timeout' }), effect.timeout);
        break;
      case 'unwatch':
        clearTimeout(timer);
        timer = undefined;
        break;
      case 'print':
        // Lets core finish the task that reported the completion first.
        setTimeout(print, 0);
        break;
    }
  };

  const dispatch = (event: PrintEvent) => {
    const [next, effects] = reducePrint(phase, event);
    if (next !== phase) {
      phase = next;
      if (next !== 'printing') {
        showStatus(next);
      }
      if (isPrintSettled(next)) {
        viewportObserver.disconnect();
        pageObserver.disconnect();
      }
    }
    for (const effect of effects) {
      run(effect);
    }
  };

  viewer.addListener('readystatechange', () => {
    dispatch(
      viewer.readyState === ReadyState.COMPLETE
        ? {
            type: 'complete',
            pageCount: viewportElement.querySelectorAll(
              `${spreadContainerSelector} > [data-vivliostyle-page-container]`,
            ).length,
          }
        : { type: 'progress' },
    );
  });
  viewer.addListener('error', () => dispatch({ type: 'error' }));
  viewportObserver.observe(viewportElement, { childList: true });

  showStatus('preparing');
  dispatch({ type: 'progress' });
  viewer.loadPublication(publicationUrl);
}
