// Contract between the stage document and the page that embeds it. Both sides
// import this module, so it must not pull in the stage's runtime.

export type StageStatus = 'loading' | 'interactive' | 'complete';

export const viewModes = ['scroll', 'single', 'spread'] as const;
export type ViewMode = (typeof viewModes)[number];
export const defaultViewMode: ViewMode = 'scroll';

/** Colors of what the stage shows around the pages; pages keep their own. */
export const colorSchemes = ['light', 'dark'] as const;
export type ColorScheme = (typeof colorSchemes)[number];

export type PageProgression = 'ltr' | 'rtl';

/**
 * How large the pages are shown: fitted to the viewport's width, or so that a
 * whole page or spread fits in it, or at a fixed scale where 1 is 100%.
 */
export const zoomFits = ['fit-width', 'fit-page'] as const;
export type ZoomFit = (typeof zoomFits)[number];
export type Zoom = ZoomFit | number;
export const defaultZoom: Zoom = 'fit-page';

export const minZoomScale = 0.25;
export const maxZoomScale = 5;
/** The scales that zooming in and out step through. */
export const zoomSteps = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5,
] as const;

export interface StageState {
  /** Loading from the moment a reload is asked for. */
  status: StageStatus;
  /**
   * The latest load reported an error, or nothing moved forward for a long
   * time. What is shown may be an earlier version of the publication.
   */
  failed: boolean;
  viewMode: ViewMode;
  zoom: Zoom;
  /** The scale the pages are shown at, which a fitting zoom works out. */
  scale: number;
  pageProgression: PageProgression;
  /**
   * Zero-based index of the current page across the whole publication. In
   * spread mode it is one of the pages of the displayed spread.
   */
  pageIndex: number;
  /**
   * Pages laid out so far, but no fewer than the rendering a reload replaced
   * had until the new one is complete; final once `status` is `complete`.
   */
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
}

export type StageStateListener = (state: StageState) => void;

export interface StageController {
  /** Moves by one page, or by one spread in spread mode. */
  next(): void;
  prev(): void;
  /** Clamped to the pages laid out so far. */
  goTo(pageIndex: number): void;
  setViewMode(viewMode: ViewMode): void;
  /** A fixed scale is clamped to `minZoomScale` and `maxZoomScale`. */
  setZoom(zoom: Zoom): void;
  setColorScheme(colorScheme: ColorScheme): void;
  /** Calls `listener` with the current state at once, then on every change. */
  subscribe(listener: StageStateListener): () => void;
}

/**
 * `postMessage` command the embedder sends to the stage window, transferring
 * the `MessagePort` that the stage exposes its {@link StageController} on.
 */
export const stageBindCommand = 'viewer-stage-bind';

/**
 * Search parameters of the stage URL. The view mode, zoom and color scheme
 * are initial values, so that the stage starts with them instead of switching once
 * the embedder binds.
 *
 * With `print=true` the stage is a top-level print tab instead: it lays the
 * publication out, opens the print dialog once, then closes the tab. It has
 * no controller then, and shows its status in the `locale` given.
 */
export const stageSearchParams = {
  src: 'src',
  viewMode: 'viewMode',
  zoom: 'zoom',
  colorScheme: 'colorScheme',
  print: 'print',
  locale: 'locale',
} as const;

export function isViewMode(value: unknown): value is ViewMode {
  return viewModes.includes(value as ViewMode);
}

export function isColorScheme(value: unknown): value is ColorScheme {
  return colorSchemes.includes(value as ColorScheme);
}

export function isZoom(value: unknown): value is Zoom {
  return (
    zoomFits.includes(value as ZoomFit) ||
    (typeof value === 'number' && Number.isFinite(value) && value > 0)
  );
}

export function clampZoomScale(scale: number): number {
  return Math.min(Math.max(scale, minZoomScale), maxZoomScale);
}

/** The zoom a search parameter value stands for, or null. */
export function parseZoom(value: string | null): Zoom | null {
  if (value === null) {
    return null;
  }
  if (zoomFits.includes(value as ZoomFit)) {
    return value as ZoomFit;
  }
  const scale = Number(value);
  return value !== '' && isZoom(scale) ? scale : null;
}

/**
 * The step after `scale` in `direction`, or null past the last one. A scale
 * between steps, as a fitting zoom gives, goes to the nearest step that way.
 */
export function stepZoomScale(
  scale: number,
  direction: 'in' | 'out',
): number | null {
  // Displayed as whole percents, so a scale within that of a step is on it.
  const tolerance = 0.005;
  if (direction === 'in') {
    return zoomSteps.find((step) => step > scale + tolerance) ?? null;
  }
  return zoomSteps.findLast((step) => step < scale - tolerance) ?? null;
}
