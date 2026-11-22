import { invariant } from 'outvariant';

import { stageSearchParams } from '@v/viewer/protocol';
import { m } from '../../generated/paraglide/messages';
import { getLocale } from '../../generated/paraglide/runtime';
import { $cli, $viewer } from '../accessors';

let printWindow: Window | null = null;
let printSession = 0;

// Printing happens in a top-level tab because Firefox crashes generating its
// print preview for the nested cross-origin isolated viewer iframe (#64).
export async function printPdf() {
  // The tab closes itself after printing, so one still open is a print in
  // progress.
  if (printWindow && !printWindow.closed) {
    printWindow.focus();
    return;
  }
  const session = ++printSession;

  // Open synchronously to stay within the user gesture; the viewer prints
  // itself and closes the tab when its URL asks it to print.
  const openedWindow = window.open('about:blank', '_blank');
  invariant(openedWindow, 'Failed to open a tab for printing');
  printWindow = openedWindow;
  openedWindow.document.title = m.print_pdf_preparing();
  openedWindow.document.body.textContent = m.print_pdf_preparing();
  try {
    const cli = await $cli.awaiter({ timeout: 10_000 });
    const viewerUrl = new URL(await cli.createPrintViewerUrlPromise());
    if (openedWindow.closed || session !== printSession) {
      return;
    }
    viewerUrl.searchParams.set(stageSearchParams.paperSize, $viewer.paperSize);
    viewerUrl.searchParams.set(stageSearchParams.locale, getLocale());
    openedWindow.location.href = viewerUrl.href;
  } catch (error) {
    openedWindow.close();
    throw error;
  }
}
