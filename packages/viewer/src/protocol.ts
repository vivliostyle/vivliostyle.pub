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

export interface StageState {
  /** Loading from the moment a reload is asked for. */
  status: StageStatus;
  /**
   * The latest load reported an error, or nothing moved forward for a long
   * time. What is shown may be an earlier version of the publication.
   */
  failed: boolean;
  viewMode: ViewMode;
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
 * Search parameters of the stage URL. The view mode and color scheme are
 * initial values, so that the stage starts with them instead of switching once
 * the embedder binds.
 *
 * With `print=true` the stage is a top-level print tab instead: it lays the
 * publication out, opens the print dialog once, then closes the tab. It has
 * no controller then, and shows its status in the `locale` given.
 */
export const stageSearchParams = {
  src: 'src',
  viewMode: 'viewMode',
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
