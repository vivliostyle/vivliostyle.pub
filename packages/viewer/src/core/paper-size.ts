export interface Size {
  width: number;
  height: number;
}

const pxPerMm = 96 / 25.4;

// Converted exactly, as core does for `@page { size: A4 }`, so a document
// without a page size lays out the same as one that names A4.
export const defaultPaperSize: Readonly<Size> = Object.freeze({
  width: 210 * pxPerMm,
  height: 297 * pxPerMm,
});
