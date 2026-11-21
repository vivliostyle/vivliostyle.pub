import {
  defaultPaperSize,
  isPaperSize,
  type PaperSize,
} from '@v/viewer/protocol';

const storageKey = 'viewer-paper-size';

// Storage access throws where the browser blocks it.
export function loadViewerPaperSize(): PaperSize {
  try {
    const stored = localStorage.getItem(storageKey);
    return isPaperSize(stored) ? stored : defaultPaperSize;
  } catch {
    return defaultPaperSize;
  }
}

export function saveViewerPaperSize(paperSize: PaperSize) {
  try {
    localStorage.setItem(storageKey, paperSize);
  } catch {
    // It then lasts until the page is reloaded.
  }
}
