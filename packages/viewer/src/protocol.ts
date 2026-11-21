// Contract between the stage document and the page that embeds it. Both sides
// import this module, so it must not pull in the stage's runtime.

export type StageStatus = 'loading' | 'interactive' | 'complete';

export const viewModes = ['single', 'spread', 'scroll'] as const;
export type ViewMode = (typeof viewModes)[number];
export const defaultViewMode: ViewMode = 'single';

/** Paper sizes the stage lays out documents on when they have no `@page` size. */
export const paperSizes = [
  'a4',
  'a5',
  'a6',
  'jis-b5',
  'jis-b6',
  'letter',
] as const;
export type PaperSize = (typeof paperSizes)[number];
export const defaultPaperSize: PaperSize = 'a4';

export type PageProgression = 'ltr' | 'rtl';

export interface StageState {
  /** Loading from the moment a reload is asked for. */
  status: StageStatus;
  /**
   * The latest load reported an error, or nothing moved forward for a long
   * time. What is shown may be an earlier version of the publication.
   */
  failed: boolean;
  viewMode: ViewMode;
  paperSize: PaperSize;
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
  /** Re-lays out the publication when the size differs from the current one. */
  setDefaultPaperSize(paperSize: PaperSize): void;
  /** Calls `listener` with the current state at once, then on every change. */
  subscribe(listener: StageStateListener): () => void;
}

/**
 * `postMessage` command the embedder sends to the stage window, transferring
 * the `MessagePort` that the stage exposes its {@link StageController} on.
 */
export const stageBindCommand = 'viewer-stage-bind';

/**
 * Search parameters of the stage URL. The view mode and paper size are
 * initial values, so that a stored preference holds from the first layout on.
 */
export const stageSearchParams = {
  src: 'src',
  viewMode: 'viewMode',
  paperSize: 'paperSize',
} as const;

export function isViewMode(value: unknown): value is ViewMode {
  return viewModes.includes(value as ViewMode);
}

export function isPaperSize(value: unknown): value is PaperSize {
  return paperSizes.includes(value as PaperSize);
}
