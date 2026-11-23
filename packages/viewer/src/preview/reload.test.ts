import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CommandGate,
  type CoreAction,
  type CoreCommandEvents,
  type CoreCommandPayload,
} from '../core/command-gate';
import {
  initialReloadState,
  isBusy,
  isHolding,
  ReloadController,
  type ReloadEffect,
  type ReloadEvent,
  type ReloadState,
  reduceReload,
  reloadFailed,
  reloadStatus,
} from './reload';

function run(events: ReloadEvent[], from = initialReloadState) {
  let state = from;
  const effects: ReloadEffect[] = [];
  for (const event of events) {
    const [next, emitted] = reduceReload(state, event);
    state = next;
    effects.push(...emitted);
  }
  return { state, effects };
}

const issued = (effects: ReloadEffect[]) =>
  effects.flatMap((effect) => (effect.type === 'issue' ? [effect.hard] : []));

const soft: ReloadEvent = { type: 'request', hard: false };
const hard: ReloadEvent = { type: 'request', hard: true };
const settled: ReloadEvent = { type: 'settled', ran: true };
const layoutStart: ReloadEvent = { type: 'layoutStart' };
const shown: ReloadEvent = { type: 'shown' };
const status = (value: ReloadState['coreStatus']): ReloadEvent => ({
  type: 'status',
  status: value,
});
// What core and the presentation report for an issued load until its pages
// cover the view.
const laidOutToView: ReloadEvent[] = [
  settled,
  status('loading'),
  layoutStart,
  status('interactive'),
  shown,
];

describe('reduceReload', () => {
  it('issues the first request at once', () => {
    const { state, effects } = run([soft]);
    expect(issued(effects)).toEqual([false]);
    expect(state.inFlight).toBe(true);
    expect(reloadStatus(state)).toBe('loading');
  });

  it('holds a burst until the layout in progress is shown', () => {
    const burst = run([
      soft,
      soft,
      settled,
      status('loading'),
      layoutStart,
      soft,
      status('interactive'),
      soft,
      { type: 'progress' },
    ]);
    expect(issued(burst.effects)).toEqual([false]);
    expect(burst.state.pending).toEqual({ hard: false });
    expect(reloadStatus(burst.state)).toBe('loading');

    const after = run([shown], burst.state);
    expect(issued(after.effects)).toEqual([false]);
    expect(after.state.pending).toBeNull();
    expect(after.state.owedStarts).toBe(1);
  });

  it('advances by one load per layout shown under continued editing', () => {
    let state = run([soft]).state;
    const loads: boolean[] = [];
    for (let step = 0; step < 3; step++) {
      const { state: next, effects } = run(
        [soft, ...laidOutToView, soft],
        state,
      );
      loads.push(...issued(effects));
      state = next;
    }
    expect(loads).toEqual([false, false, false]);
    expect(state.pending).toEqual({ hard: false });
  });

  it('ignores a view shown before core started the latest layout', () => {
    // The pages on screen until core clears them are those of the layout
    // the load replaces.
    const { state, effects } = run([soft, soft, settled, shown]);
    expect(issued(effects)).toEqual([false]);
    expect(isHolding(state)).toBe(true);
  });

  it('releases the hold once core completes the latest layout', () => {
    const { effects } = run([
      soft,
      settled,
      layoutStart,
      soft,
      status('complete'),
    ]);
    expect(issued(effects)).toEqual([false, false]);
  });

  it('takes a completion before the latest layout for the one it cancels', () => {
    const { state, effects } = run([soft, settled, soft, status('complete')]);
    expect(issued(effects)).toEqual([false]);
    expect(isHolding(state)).toBe(true);
  });

  it('releases the hold when the layout fails or stalls', () => {
    const holding = run([soft, settled, layoutStart, soft]).state;
    expect(issued(run([{ type: 'error' }], holding).effects)).toEqual([false]);
    expect(issued(run([{ type: 'stallTimeout' }], holding).effects)).toEqual([
      false,
    ]);
    const unissued = run([soft, soft, { type: 'settled', ran: false }]);
    expect(issued(unissued.effects)).toEqual([false, false]);
  });

  it('keeps a hard request through the soft ones after it', () => {
    const { effects } = run([soft, hard, soft, settled]);
    expect(issued(effects)).toEqual([false, true]);
  });

  it('does not hold a hard request for a soft layout', () => {
    // The soft layout uses the styles or configuration the hard one replaces.
    const { effects } = run([soft, settled, layoutStart, soft, hard]);
    expect(issued(effects)).toEqual([false, true]);
  });

  it('holds a hard request for the hard layout in progress', () => {
    const holding = run([hard, settled, layoutStart, hard, soft]);
    expect(issued(holding.effects)).toEqual([true]);
    expect(holding.state.pending).toEqual({ hard: true });
    expect(issued(run([shown], holding.state).effects)).toEqual([true]);
  });

  it('credits the start of a soft layout to it, not to a hard load after it', () => {
    // Core runs the layout task the soft load scheduled before it takes the
    // hard load, which then cancels that layout.
    const overtaken = run([soft, settled, hard]);
    expect(issued(overtaken.effects)).toEqual([false, true]);

    const softLayout = run(
      [layoutStart, status('interactive'), shown, status('complete'), soft],
      overtaken.state,
    );
    expect(issued(softLayout.effects)).toEqual([]);
    const hardSettled = run([settled], softLayout.state);
    expect(issued(hardSettled.effects)).toEqual([]);

    const hardLayout = run([layoutStart, shown], hardSettled.state);
    expect(issued(hardLayout.effects)).toEqual([false]);
  });

  describe('with a paper size change', () => {
    const idle = run([soft, ...laidOutToView, status('complete')]).state;

    it('holds a reload for the layout the change makes', () => {
      expect(isBusy(idle)).toBe(false);
      const resized = run([{ type: 'configure' }, soft], idle);
      expect(issued(resized.effects)).toEqual([]);
      // The view shown before core starts the new layout is the old one.
      const early = run([shown, status('complete')], resized.state);
      expect(issued(early.effects)).toEqual([]);
      expect(issued(run([layoutStart, shown], early.state).effects)).toEqual([
        false,
      ]);
    });

    it('waits for its layout when it follows a load', () => {
      // The load's layout starts first and is cancelled by the change.
      const { state, effects } = run(
        [
          soft,
          { type: 'configure' },
          settled,
          layoutStart,
          shown,
          soft,
          layoutStart,
        ],
        idle,
      );
      expect(issued(effects)).toEqual([false]);
      expect(issued(run([shown], state).effects)).toEqual([false]);
    });

    it('takes the place of the layout a hold waits for', () => {
      const holding = run([soft, settled, layoutStart, soft], idle).state;
      const restarted = run(
        [{ type: 'configure' }, shown, layoutStart, status('interactive')],
        holding,
      );
      expect(issued(restarted.effects)).toEqual([]);
      expect(issued(run([shown], restarted.state).effects)).toEqual([false]);
    });
  });

  it('stops waiting for layouts core never starts after a failure', () => {
    const failed = run([soft, { type: 'configure' }, { type: 'error' }]);
    expect(isHolding(failed.state)).toBe(false);
    const unissued = run([soft, settled, layoutStart, { type: 'configure' }]);
    // A load that could not be sent owes no layout; the change still does.
    const thrown = run([hard, { type: 'settled', ran: false }], unissued.state);
    expect(issued(thrown.effects)).toEqual([true]);
    expect(thrown.state.owedStarts).toBe(1);
  });

  it('does not restart the stall timer on requests', () => {
    const holding = run([soft, settled, layoutStart]).state;
    expect(run([soft, soft], holding).effects).toEqual([]);
  });

  it('reports loading from the request on, whatever core last said', () => {
    const complete = run([
      soft,
      settled,
      layoutStart,
      status('complete'),
    ]).state;
    expect(reloadStatus(complete)).toBe('complete');
    expect(isBusy(complete)).toBe(false);

    const requested = run([soft], complete).state;
    expect(reloadStatus(requested)).toBe('loading');
    const queued = run([soft], requested).state;
    expect(reloadStatus(queued)).toBe('loading');
  });

  it('marks a failure until the next load is issued', () => {
    const failed = run([soft, { type: 'error' }]).state;
    expect(reloadFailed(failed)).toBe(true);

    // Core lays the previous publication out again after a failed load; the
    // failure stays, since what is shown is not the latest content.
    const relaidOut = run([settled, status('complete')], failed).state;
    expect(reloadFailed(relaidOut)).toBe(true);

    const retried = run([soft], relaidOut).state;
    expect(reloadFailed(retried)).toBe(false);
  });

  it('marks a failure when the load could not be issued', () => {
    const { state } = run([soft, { type: 'settled', ran: false }]);
    expect(reloadFailed(state)).toBe(true);
  });

  it('forgets the failure of a load overtaken by a pending one', () => {
    const { state, effects } = run([soft, soft, { type: 'error' }, settled]);
    expect(issued(effects)).toEqual([false, false]);
    expect(reloadFailed(state)).toBe(false);
  });

  it('ignores errors and timeouts while nothing is in progress', () => {
    expect(run([{ type: 'error' }]).state).toEqual(initialReloadState);
    const idle = run([soft, settled, layoutStart, status('complete')]).state;
    expect(run([{ type: 'error' }], idle).state).toEqual(idle);
    expect(run([{ type: 'stallTimeout' }], idle).state).toEqual(idle);
  });

  it('flags a stall until something moves forward', () => {
    const stalled = run([soft, settled, { type: 'stallTimeout' }]).state;
    expect(reloadFailed(stalled)).toBe(true);

    const resumed = run([{ type: 'progress' }], stalled);
    expect(reloadFailed(resumed.state)).toBe(false);
    expect(resumed.effects).toEqual([{ type: 'watch' }]);
  });

  it('watches while busy and stops once core is complete', () => {
    const { effects } = run([soft, settled, status('interactive')]);
    expect(effects.filter((effect) => effect.type !== 'issue')).toEqual([
      { type: 'watch' },
      { type: 'watch' },
      { type: 'watch' },
    ]);
    expect(
      run([soft, settled, layoutStart, status('complete')]).effects.at(-1),
    ).toEqual({ type: 'unwatch' });
  });
});

class FakeCore implements CoreCommandEvents {
  readonly issued: string[] = [];
  readonly #listeners = new Map<string, ((p: CoreCommandPayload) => void)[]>();

  addListener(type: string, listener: (payload: CoreCommandPayload) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  done(action: CoreAction) {
    for (const listener of this.#listeners.get('done') ?? []) {
      listener({ a: action });
    }
  }
}

describe('ReloadController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(stallTimeout = 1000) {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    const states: ReloadState[] = [];
    const controller = new ReloadController({
      gate,
      load: (isHard) => core.issued.push(isHard ? 'hard load' : 'load'),
      onChange: (state) => states.push(state),
      stallTimeout,
    });
    return { core, gate, controller, states };
  }

  it('runs a burst as the first load and one load with the latest content', async () => {
    const { core, controller } = setup();
    controller.dispatch(soft);
    controller.dispatch(soft);
    controller.dispatch(hard);
    controller.dispatch(soft);
    expect(core.issued).toEqual(['load']);

    core.done('loadPublication');
    await vi.waitFor(() => expect(core.issued).toEqual(['load', 'hard load']));
    core.done('loadPublication');
    await vi.waitFor(() => expect(controller.state.inFlight).toBe(false));
    expect(core.issued).toEqual(['load', 'hard load']);
  });

  it('shares the gate with paper size changes without losing the last reload', async () => {
    const { core, gate, controller } = setup();
    const configure = (size: string) =>
      void gate.run('configure', () => core.issued.push(`configure ${size}`), {
        key: 'paperSize',
      });
    configure('a5');
    controller.dispatch(soft);
    configure('b5');
    configure('a6');
    // Issued to the gate, the load waits there; the request after it waits
    // for its layout to be shown.
    controller.dispatch(soft);
    expect(core.issued).toEqual(['configure a5']);

    core.done('configure');
    await vi.waitFor(() =>
      expect(core.issued).toEqual(['configure a5', 'load']),
    );
    core.done('loadPublication');
    await vi.waitFor(() =>
      expect(core.issued).toEqual(['configure a5', 'load', 'configure a6']),
    );
    core.done('configure');
    controller.dispatch(layoutStart);
    await vi.waitFor(() => expect(controller.state.inFlight).toBe(false));
    expect(core.issued).toHaveLength(3);
    controller.dispatch(shown);
    await vi.waitFor(() =>
      expect(core.issued).toEqual([
        'configure a5',
        'load',
        'configure a6',
        'load',
      ]),
    );
  });

  it('reports a stall once nothing moved forward for the timeout', async () => {
    const { core, controller } = setup(1000);
    controller.dispatch(soft);
    core.done('loadPublication');
    await vi.waitFor(() => expect(controller.state.inFlight).toBe(false));
    controller.dispatch(status('loading'));

    vi.advanceTimersByTime(900);
    controller.dispatch({ type: 'progress' });
    vi.advanceTimersByTime(900);
    expect(reloadFailed(controller.state)).toBe(false);

    vi.advanceTimersByTime(200);
    expect(reloadFailed(controller.state)).toBe(true);

    controller.dispatch(status('complete'));
    expect(reloadFailed(controller.state)).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(reloadFailed(controller.state)).toBe(false);
  });

  it('reports every change of state', () => {
    const { controller, states } = setup();
    controller.dispatch(soft);
    controller.dispatch(soft);
    expect(states.map(reloadStatus)).toEqual(['loading', 'loading']);
    expect(states.at(-1)?.pending).toEqual({ hard: false });
  });
});
