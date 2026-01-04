import { invariant } from 'outvariant';
import { subscribe } from 'valtio';

import { generateId } from '../../libs/generate-id';
import { $cli, $ui } from '../accessors';

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
  const cli = $cli.valueOrThrow;

  if (!cli.viewerIframeElement) {
    await Promise.race([
      new Promise<void>((resolve) => {
        subscribe(cli, () => {
          cli.viewerIframeElement && resolve();
        });
      }),
      new Promise((resolve) => setTimeout(resolve, 10_000)), // timeout
    ]);
  }

  invariant(cli.viewerIframeElement, 'Viewer iframe element is not set');
  const element = cli.viewerIframeElement;
  const target = new URL(element.src);
  // Delay to ensure the iframe is fully loaded
  setTimeout(() => {
    element.contentWindow?.postMessage({ type: 'print-pdf' }, target.origin);
  }, 500);
}
