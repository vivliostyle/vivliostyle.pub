// Contract between the stage document and the page that embeds it. Both sides
// import this module, so it must not pull in the stage's runtime.

export type StageStatus = 'loading' | 'interactive' | 'complete';

export interface StageState {
  status: StageStatus;
  /** Zero-based index of the displayed page across the whole publication. */
  pageIndex: number;
  /** Pages laid out so far; final once `status` is `complete`. */
  pageCount: number;
}

export type StageStateListener = (state: StageState) => void;

export interface StageController {
  next(): void;
  prev(): void;
  /** Calls `listener` with the current state at once, then on every change. */
  subscribe(listener: StageStateListener): () => void;
}

/**
 * `postMessage` command the embedder sends to the stage window, transferring
 * the `MessagePort` that the stage exposes its {@link StageController} on.
 */
export const stageBindCommand = 'viewer-stage-bind';
