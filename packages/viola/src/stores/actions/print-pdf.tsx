import { invariant } from 'outvariant';

import { m } from '../../generated/paraglide/messages';
import { $cli } from '../accessors';

let printing = false;

// Printing happens in a top-level tab rather than the nested preview pane:
// Firefox crashes the sandbox-origin content process while generating its
// print preview (the static document clone) for the doubly-nested
// cross-origin isolated viewer iframe.
// https://github.com/vivliostyle/vivliostyle.pub/issues/64
export async function printPdf() {
  if (printing) {
    return;
  }
  printing = true;
  try {
    // Open the tab synchronously so the browser attributes it to the user
    // gesture; navigate once the viewer URL resolves. The viewer prints
    // itself when it sees the `print` hash parameter and closes the tab when
    // the dialog is dismissed (see cli-bundle's viewer-adapter).
    const printWindow = window.open('about:blank', '_blank');
    invariant(printWindow, 'Failed to open a tab for printing');
    printWindow.document.title = m.print_pdf_preparing();
    printWindow.document.body.textContent = m.print_pdf_preparing();
    try {
      const cli = await $cli.awaiter();
      const viewerUrl = await cli.createViewerUrlPromise();
      printWindow.location.href = `${viewerUrl}&print=true`;
    } catch (error) {
      printWindow.close();
      throw error;
    }
  } finally {
    printing = false;
  }
}
