import { invariant } from 'outvariant';

import { m } from '../../generated/paraglide/messages';
import { $cli } from '../accessors';

let printWindow: Window | null = null;
let printSession = 0;

// Printing happens in a top-level tab rather than the nested preview pane:
// Firefox crashes the sandbox-origin content process while generating its
// print preview (the static document clone) for the doubly-nested
// cross-origin isolated viewer iframe.
// https://github.com/vivliostyle/vivliostyle.pub/issues/64
export async function printPdf() {
  // While a previous invocation is still preparing, focus its tab instead of
  // stacking another one. A user-closed tab reports `closed`, so a hung URL
  // resolution can never permanently disable this action. (After navigation,
  // COOP severs the handle — which also reports `closed` — so each further
  // click intentionally starts a fresh print tab.)
  if (printWindow && !printWindow.closed) {
    printWindow.focus();
    return;
  }
  const session = ++printSession;

  // Open the tab synchronously so the browser attributes it to the user
  // gesture; navigate once the viewer URL resolves. The viewer prints itself
  // when it sees the `print` hash parameter and closes the tab when the
  // dialog is dismissed (see cli-bundle's viewer-adapter).
  const openedWindow = window.open('about:blank', '_blank');
  invariant(openedWindow, 'Failed to open a tab for printing');
  printWindow = openedWindow;
  openedWindow.document.title = m.print_pdf_preparing();
  openedWindow.document.body.textContent = m.print_pdf_preparing();
  try {
    const cli = await $cli.awaiter();
    const viewerUrl = await cli.createViewerUrlPromise();
    if (openedWindow.closed || session !== printSession) {
      return;
    }
    openedWindow.location.href = `${viewerUrl}&print=true`;
  } catch (error) {
    openedWindow.close();
    throw error;
  }
}
