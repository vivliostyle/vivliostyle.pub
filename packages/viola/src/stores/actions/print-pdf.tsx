import { invariant } from 'outvariant';

import { m } from '../../generated/paraglide/messages';
import { $cli } from '../accessors';

let printWindow: Window | null = null;
let printSession = 0;

// Printing happens in a top-level tab because Firefox crashes generating its
// print preview for the nested cross-origin isolated viewer iframe (#64).
export async function printPdf() {
  // A COOP-severed handle (after navigation) also reports `closed`, so each
  // click after a successful navigation starts a fresh tab.
  if (printWindow && !printWindow.closed) {
    printWindow.focus();
    return;
  }
  const session = ++printSession;

  // Open synchronously to stay within the user gesture; the viewer prints
  // itself and closes the tab when it sees the `print` hash parameter.
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
