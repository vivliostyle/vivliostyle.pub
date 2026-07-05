import { invariant } from 'outvariant';
import { subscribe } from 'valtio';

import { extensionSandboxOrigin } from '../../extensions/sandbox-origin';
import { generateId } from '../../libs/generate-id';
import { $ui } from '../accessors';
import {
  type ExtensionId,
  extensionFrameKey,
  extensionFrames,
} from '../proxies/extension';
import type { PaneId } from '../proxies/ui';

const previewExtensionId = 'preview' as ExtensionId;
const previewPanePath = '.';

// Polls `print-pdf-query` until the viewer answers `print-pdf-ready` (every
// page is rendered); polling stays correct across view reloads. The timeout
// must accommodate a full book render from a cold start.
function waitForPrintReady(frame: HTMLIFrameElement): Promise<boolean> {
  const targetOrigin = extensionSandboxOrigin(previewExtensionId);
  return new Promise((resolve) => {
    const query = () => {
      frame.contentWindow?.postMessage(
        { type: 'print-pdf-query' },
        targetOrigin,
      );
    };
    const finish = (ready: boolean) => {
      clearInterval(interval);
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(ready);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return;
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type !== 'print-pdf-ready') return;
      finish(true);
    };
    window.addEventListener('message', onMessage);
    const interval = setInterval(query, 250);
    const timer = setTimeout(() => finish(false), 300_000);
    query();
  });
}

function waitForPrintDone(frame: HTMLIFrameElement): Promise<boolean> {
  const targetOrigin = extensionSandboxOrigin(previewExtensionId);
  return new Promise((resolve) => {
    const finish = (done: boolean) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(done);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return;
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type !== 'print-pdf-done') return;
      finish(true);
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => finish(false), 600_000);
  });
}

let printing = false;

export async function printPdf() {
  if (printing) {
    return;
  }
  printing = true;
  try {
    await printPdfViaPreviewPane();
  } finally {
    printing = false;
  }
}

async function printPdfViaPreviewPane() {
  // Ensure the viewer pane is visible
  let addedTabId: PaneId | undefined;
  if (
    !$ui.tabs.some(
      (tab) =>
        tab.type === 'extension' &&
        tab.extensionId === previewExtensionId &&
        tab.panePath === previewPanePath,
    )
  ) {
    addedTabId = generateId();
    $ui.tabs = [
      ...$ui.tabs,
      {
        id: addedTabId,
        type: 'extension',
        extensionId: previewExtensionId,
        panePath: previewPanePath,
      },
    ];
  }

  const frameKey = extensionFrameKey(previewExtensionId, previewPanePath);
  if (!extensionFrames[frameKey]) {
    await new Promise<void>((resolve) => {
      const unsubscribe = subscribe(extensionFrames, check);
      const timer = setTimeout(finish, 10_000);
      function finish() {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
      function check() {
        if (extensionFrames[frameKey]) finish();
      }
      check();
    });
  }

  const element = extensionFrames[frameKey];
  invariant(element, 'Preview extension frame is not mounted');

  const ready = await waitForPrintReady(element);
  invariant(ready, 'Preview pane did not become ready for printing');
  const printDone = waitForPrintDone(element);
  element.contentWindow?.postMessage(
    { type: 'print-pdf' },
    extensionSandboxOrigin(previewExtensionId),
  );

  // Restore the layout only after the dialog closes — the print preview is
  // fed live from the pane's iframe.
  if (addedTabId && (await printDone)) {
    $ui.tabs = $ui.tabs.filter((tab) => tab.id !== addedTabId);
  }
}
