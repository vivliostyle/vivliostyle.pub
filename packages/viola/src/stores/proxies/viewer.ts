import { proxy } from 'valtio';

import { defaultPaperSize, type PaperSize } from '@v/viewer/protocol';

export const viewer = proxy({
  /**
   * The default paper size the preview last laid documents out on, which
   * printing uses too. The preview keeps its own preference and reports it.
   */
  paperSize: defaultPaperSize as PaperSize,
});
