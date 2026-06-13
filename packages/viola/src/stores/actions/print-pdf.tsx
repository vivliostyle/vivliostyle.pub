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

const previewExtensionId = 'preview' as ExtensionId;
const previewPanePath = '.';

// Polls `print-pdf-query` until the view answers `print-pdf-ready` (the nested
// viewer has loaded). Polling stays correct across view reloads, unlike a
// one-shot ready announcement.
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
    const timer = setTimeout(() => finish(false), 30_000);
    query();
  });
}

export async function printPdf() {
  // Ensure the viewer pane is visible
  if (
    !$ui.tabs.some(
      (tab) =>
        tab.type === 'extension' &&
        tab.extensionId === previewExtensionId &&
        tab.panePath === previewPanePath,
    )
  ) {
    $ui.tabs = [
      ...$ui.tabs,
      {
        id: generateId(),
        type: 'extension',
        extensionId: previewExtensionId,
        panePath: previewPanePath,
      },
    ];
  }

  const frameKey = extensionFrameKey(previewExtensionId, previewPanePath);
  if (!extensionFrames[frameKey]) {
    await Promise.race([
      new Promise<void>((resolve) => {
        subscribe(extensionFrames, () => {
          extensionFrames[frameKey] && resolve();
        });
      }),
      new Promise((resolve) => setTimeout(resolve, 10_000)), // timeout
    ]);
  }

  const element = extensionFrames[frameKey];
  invariant(element, 'Preview extension frame is not mounted');

  const ready = await waitForPrintReady(element);
  invariant(ready, 'Preview pane did not become ready for printing');
  element.contentWindow?.postMessage(
    { type: 'print-pdf' },
    extensionSandboxOrigin(previewExtensionId),
  );
}
