import type { CommandGate } from './command-gate';
import type { StageStatus } from './protocol';

export interface ReloadState {
  /**
   * The reload asked for while another one cannot be issued, standing for
   * every request since; hard if any of them was.
   */
  pending: { hard: boolean } | null;
  /** A load core has not taken yet, i.e. its command is not done. */
  inFlight: boolean;
  /** Whether the latest load issued was hard. */
  issuedHard: boolean;
  /**
   * Layouts core is still to start for the commands sent to it: loads and
   * paper size changes. Until they have, what is shown or completed is a
   * layout those commands replace.
   */
  owedStarts: number;
  /** The layout core started last is not shown yet. */
  awaitingView: boolean;
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
  issuedHard: false,
  owedStarts: 0,
  awaitingView: false,
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
  /**
   * Core started a layout, for the latest load or for a change of the paper
   * size, which shows the same content.
   */
  | { type: 'layoutStart' }
  /** The pages of the layout core started last cover the view. */
  | { type: 'shown' }
  /** A paper size change was sent to core, which lays out again for it. */
  | { type: 'configure' }
  | { type: 'error' }
  | { type: 'stallTimeout' };

export type ReloadEffect =
  | { type: 'issue'; hard: boolean }
  /** (Re)starts the stall timer. */
  | { type: 'watch' }
  | { type: 'unwatch' };

/**
 * Whether the latest layout is not shown yet, nor ended without being shown;
 * a reload then waits, since the next load would cancel the layout.
 */
export function isHolding(state: ReloadState): boolean {
  return state.owedStarts > 0 || state.awaitingView;
}

/** Whether a load or the layout core is running for one is unfinished. */
export function isBusy(state: ReloadState): boolean {
  return (
    state.started &&
    (state.pending !== null ||
      state.inFlight ||
      isHolding(state) ||
      state.coreStatus !== 'complete')
  );
}

/** Whether what the presentation or core reports is of the latest layout. */
function isLatestLayout(state: ReloadState): boolean {
  return state.owedStarts === 0 && state.awaitingView;
}

/**
 * Never two loads with core at once. A soft reload waits for the layout in
 * progress to be shown, so that continued editing shows a rendering at each
 * step instead of none until it stops. A hard one need not wait for a soft
 * layout, which uses what the change replaces.
 */
function canIssue(state: ReloadState): boolean {
  return (
    state.pending !== null &&
    !state.inFlight &&
    (!isHolding(state) || (state.pending.hard && !state.issuedHard))
  );
}

/**
 * Issues the pending reload if it can go now. `progressed` restarts the stall
 * timer; a request does not, or continued editing would keep a stuck layout
 * from ever being reported and given up.
 */
function settle(
  state: ReloadState,
  progressed: boolean,
): [ReloadState, ReloadEffect[]] {
  if (canIssue(state)) {
    const hard = state.pending?.hard ?? false;
    return [
      {
        ...state,
        pending: null,
        inFlight: true,
        issuedHard: hard,
        owedStarts: state.owedStarts + 1,
        started: true,
        errored: false,
        stalled: false,
      },
      [{ type: 'issue', hard }, { type: 'watch' }],
    ];
  }
  if (!progressed) {
    return [state, []];
  }
  return [state, [isBusy(state) ? { type: 'watch' } : { type: 'unwatch' }]];
}

// What core leaves undone after an error or a stall is not waited for.
const released = { owedStarts: 0, awaitingView: false };

/**
 * One load at a time goes to core, and a request while one is in progress
 * waits and absorbs every request after it, so that a burst ends in a load
 * with the latest content.
 */
export function reduceReload(
  state: ReloadState,
  event: ReloadEvent,
): [ReloadState, ReloadEffect[]] {
  switch (event.type) {
    case 'request':
      return settle(
        {
          ...state,
          pending: { hard: event.hard || (state.pending?.hard ?? false) },
        },
        false,
      );
    case 'settled':
      return settle(
        {
          ...state,
          inFlight: false,
          errored: state.errored || !event.ran,
          owedStarts: event.ran
            ? state.owedStarts
            : Math.max(0, state.owedStarts - 1),
          stalled: false,
        },
        true,
      );
    case 'status':
      return settle(
        {
          ...state,
          coreStatus: event.status,
          awaitingView:
            state.awaitingView &&
            !(event.status === 'complete' && isLatestLayout(state)),
          stalled: false,
        },
        true,
      );
    case 'configure':
      return settle({ ...state, owedStarts: state.owedStarts + 1 }, true);
    case 'layoutStart': {
      if (!state.started) {
        return [state, []];
      }
      const owedStarts = Math.max(0, state.owedStarts - 1);
      return settle(
        {
          ...state,
          owedStarts,
          awaitingView: state.awaitingView || owedStarts === 0,
          stalled: false,
        },
        true,
      );
    }
    case 'shown':
      return isLatestLayout(state)
        ? settle({ ...state, awaitingView: false }, true)
        : [state, []];
    case 'progress':
      return isBusy(state)
        ? [{ ...state, stalled: false }, [{ type: 'watch' }]]
        : [state, []];
    case 'error':
      return isBusy(state)
        ? settle({ ...state, errored: true, ...released }, false)
        : [state, []];
    case 'stallTimeout':
      return isBusy(state)
        ? settle({ ...state, stalled: true, ...released }, false)
        : [state, []];
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
