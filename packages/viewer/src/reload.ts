import type { CommandGate } from './command-gate';
import type { StageStatus } from './protocol';

export interface ReloadState {
  /**
   * The reload asked for while one is with core, standing for every request
   * since; hard if any of them was.
   */
  pending: { hard: boolean } | null;
  /** A load core has not taken yet, i.e. its command is not done. */
  inFlight: boolean;
  /** Whether a load was ever issued; nothing is in progress before that. */
  started: boolean;
  /** Core's ready state, which a load or a re-configuration moves back. */
  coreStatus: StageStatus;
  /** Core reported an error since the latest load was issued. */
  errored: boolean;
  /** Nothing moved forward for the stall timeout while work was in progress. */
  stalled: boolean;
}

export const initialReloadState: ReloadState = {
  pending: null,
  inFlight: false,
  started: false,
  coreStatus: 'loading',
  errored: false,
  stalled: false,
};

export type ReloadEvent =
  /** `hard` drops what core caches across loads (see `dropFontCache`). */
  | { type: 'request'; hard: boolean }
  /** The command gate settled the issued load; `ran` is false if it threw. */
  | { type: 'settled'; ran: boolean }
  | { type: 'status'; status: StageStatus }
  /** Core put pages in place or started a layout over. */
  | { type: 'progress' }
  | { type: 'error' }
  | { type: 'stallTimeout' };

export type ReloadEffect =
  | { type: 'issue'; hard: boolean }
  /** (Re)starts the stall timer. */
  | { type: 'watch' }
  | { type: 'unwatch' };

/** Whether a load or the layout core is running for one is unfinished. */
export function isBusy(state: ReloadState): boolean {
  return (
    state.started &&
    (state.pending !== null ||
      state.inFlight ||
      state.coreStatus !== 'complete')
  );
}

function watchIfBusy(state: ReloadState): ReloadEffect {
  return isBusy(state) ? { type: 'watch' } : { type: 'unwatch' };
}

function issue(
  state: ReloadState,
  hard: boolean,
): [ReloadState, ReloadEffect[]] {
  return [
    {
      ...state,
      pending: null,
      inFlight: true,
      started: true,
      errored: false,
      stalled: false,
    },
    [{ type: 'issue', hard }, { type: 'watch' }],
  ];
}

/**
 * One load at a time goes to core. A request while one is with core waits and
 * absorbs every request after it, so a burst ends in a single load with the
 * latest content; core cancels the layout of a load the next one overtakes.
 */
export function reduceReload(
  state: ReloadState,
  event: ReloadEvent,
): [ReloadState, ReloadEffect[]] {
  switch (event.type) {
    case 'request':
      if (state.inFlight) {
        return [
          {
            ...state,
            pending: { hard: event.hard || (state.pending?.hard ?? false) },
          },
          [],
        ];
      }
      return issue(state, event.hard);
    case 'settled': {
      const settled: ReloadState = {
        ...state,
        inFlight: false,
        errored: state.errored || !event.ran,
        stalled: false,
      };
      if (settled.pending) {
        return issue(settled, settled.pending.hard);
      }
      return [settled, [watchIfBusy(settled)]];
    }
    case 'status': {
      const next = { ...state, coreStatus: event.status, stalled: false };
      return [next, [watchIfBusy(next)]];
    }
    case 'progress':
      return isBusy(state)
        ? [{ ...state, stalled: false }, [{ type: 'watch' }]]
        : [state, []];
    case 'error':
      return isBusy(state) ? [{ ...state, errored: true }, []] : [state, []];
    case 'stallTimeout':
      return isBusy(state) ? [{ ...state, stalled: true }, []] : [state, []];
  }
}

/** Loading from the request on, before core takes it up. */
export function reloadStatus(state: ReloadState): StageStatus {
  return state.pending || state.inFlight ? 'loading' : state.coreStatus;
}

export function reloadFailed(state: ReloadState): boolean {
  return state.errored || state.stalled;
}

// Long enough for a cold start, where the worker compiles every manuscript
// and core fetches remote fonts before the first page.
export const defaultStallTimeout = 30_000;

export interface ReloadControllerOptions {
  gate: CommandGate;
  /** Sends core one `loadPublication` command. */
  load: (hard: boolean) => void;
  onChange: (state: ReloadState) => void;
  stallTimeout?: number;
}

/** Runs `reduceReload` against the command gate and a stall timer. */
export class ReloadController {
  readonly #options: ReloadControllerOptions;
  #state = initialReloadState;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ReloadControllerOptions) {
    this.#options = options;
  }

  get state(): ReloadState {
    return this.#state;
  }

  dispatch(event: ReloadEvent) {
    const [state, effects] = reduceReload(this.#state, event);
    this.#state = state;
    for (const effect of effects) {
      this.#run(effect);
    }
    // An effect can dispatch synchronously, so report what holds now.
    this.#options.onChange(this.#state);
  }

  #run(effect: ReloadEffect) {
    switch (effect.type) {
      case 'issue':
        void this.#options.gate
          .run('loadPublication', () => this.#options.load(effect.hard), {
            key: 'load',
          })
          .then((ran) => this.dispatch({ type: 'settled', ran }));
        break;
      case 'watch':
        clearTimeout(this.#timer);
        this.#timer = setTimeout(
          () => this.dispatch({ type: 'stallTimeout' }),
          this.#options.stallTimeout ?? defaultStallTimeout,
        );
        break;
      case 'unwatch':
        clearTimeout(this.#timer);
        this.#timer = undefined;
        break;
    }
  }
}
