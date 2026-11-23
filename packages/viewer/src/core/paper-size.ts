import type { PaperSize } from '../protocol';

export interface Size {
  width: number;
  height: number;
}

const pxPerMm = 96 / 25.4;
const pxPerIn = 96;

// Converted exactly, as core does for `@page { size: <name> }`, so a document
// without a page size lays out the same as one that names the size.
const paperSizeInPx: Record<PaperSize, Size> = {
  a4: { width: 210 * pxPerMm, height: 297 * pxPerMm },
  a5: { width: 148 * pxPerMm, height: 210 * pxPerMm },
  a6: { width: 105 * pxPerMm, height: 148 * pxPerMm },
  'jis-b5': { width: 182 * pxPerMm, height: 257 * pxPerMm },
  'jis-b6': { width: 128 * pxPerMm, height: 182 * pxPerMm },
  letter: { width: 8.5 * pxPerIn, height: 11 * pxPerIn },
};

export function paperSizeToPx(paperSize: PaperSize): Size {
  return { ...paperSizeInPx[paperSize] };
}
