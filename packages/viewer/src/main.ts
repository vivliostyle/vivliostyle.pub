import { applyColorScheme } from './color-scheme';
import { startPreview } from './preview';
import { printPublication } from './print';
import { defaultPrintLocale, isPrintLocale } from './print/messages';
import {
  defaultPaperSize,
  defaultViewMode,
  isColorScheme,
  isPaperSize,
  isViewMode,
  stageSearchParams,
} from './protocol';

const viewportElement = document.getElementById('vivliostyle-viewer-viewport');
if (!viewportElement) {
  throw new Error('Viewport element is missing');
}
const searchParams = new URLSearchParams(location.search);

const colorScheme = searchParams.get(stageSearchParams.colorScheme);
if (isColorScheme(colorScheme)) {
  applyColorScheme(colorScheme);
}

function publicationUrlFrom(src: string | null): string | null {
  if (!src) {
    return null;
  }
  const publicationUrl = new URL(src, location.href);
  // Document scripts run in this window with this origin's privileges.
  if (publicationUrl.origin !== location.origin) {
    console.error(
      `Refusing to load a cross-origin publication: ${publicationUrl.href}`,
    );
    return null;
  }
  return publicationUrl.href;
}

const publicationUrl = publicationUrlFrom(
  searchParams.get(stageSearchParams.src),
);
const paperSizeParam = searchParams.get(stageSearchParams.paperSize);
const paperSize = isPaperSize(paperSizeParam)
  ? paperSizeParam
  : defaultPaperSize;

if (searchParams.get(stageSearchParams.print) === 'true') {
  const locale = searchParams.get(stageSearchParams.locale);
  printPublication(viewportElement, {
    publicationUrl,
    paperSize,
    locale: isPrintLocale(locale) ? locale : defaultPrintLocale,
  });
} else {
  const viewMode = searchParams.get(stageSearchParams.viewMode);
  startPreview(viewportElement, {
    publicationUrl,
    viewMode: isViewMode(viewMode) ? viewMode : defaultViewMode,
    paperSize,
  });
}
