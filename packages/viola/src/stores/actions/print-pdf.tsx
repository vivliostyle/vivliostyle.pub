import { invariant } from 'outvariant';
import { subscribe } from 'valtio';

import { generateId } from '../../libs/generate-id';
import { $ui } from '../ui';
import { $viewer } from '../viewer';

export async function printPdf() {
  // Ensure the viewer pane is visible
  if ($ui.tabs.every((tab) => tab.type !== 'preview')) {
    $ui.tabs = [
      ...$ui.tabs,
      {
        id: generateId(),
        type: 'preview',
      },
    ];
  }
  if (!$viewer.iframeElement) {
    await Promise.race([
      new Promise<void>((resolve) => {
        subscribe($viewer, () => {
          $viewer.iframeElement && resolve();
        });
      }),
      new Promise((resolve) => setTimeout(resolve, 10_000)), // timeout
    ]);
  }

  invariant($viewer.url, 'Viewer URL is not set');
  invariant($viewer.iframeElement, 'Viewer iframe element is not set');
  const target = new URL(await $viewer.url);
  const element = $viewer.iframeElement;
  // Delay to ensure the iframe is fully loaded
  setTimeout(() => {
    element.contentWindow?.postMessage({ type: 'print-pdf' }, target.origin);
  }, 500);
}
