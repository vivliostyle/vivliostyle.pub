import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CommandGate,
  type CoreAction,
  type CoreCommandEvents,
  type CoreCommandPayload,
} from './command-gate';
import {
  initialReloadState,
  isBusy,
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
const status = (value: ReloadState['coreStatus']): ReloadEvent => ({
  type: 'status',
  status: value,
});

describe('reduceReload', () => {
  it('issues the first request at once', () => {
    const { state, effects } = run([soft]);
    expect(issued(effects)).toEqual([false]);
    expect(state.inFlight).toBe(true);
    expect(reloadStatus(state)).toBe('loading');
  });

  it('coalesces a burst into one load after the one core is taking', () => {
    const burst = run([soft, soft, soft, soft]);
    expect(issued(burst.effects)).toEqual([false]);
    expect(burst.state.pending).toEqual({ hard: false });

    const after = run([settled], burst.state);
    expect(issued(after.effects)).toEqual([false]);
    expect(after.state.pending).toBeNull();
    expect(after.state.inFlight).toBe(true);
  });

  it('keeps a hard request through the soft ones after it', () => {
    const { effects } = run([soft, hard, soft, settled]);
    expect(issued(effects)).toEqual([false, true]);
  });

  it('keeps a hard request when soft ones came first', () => {
    const { effects } = run([soft, soft, hard, settled, settled]);
    expect(issued(effects)).toEqual([false, true]);
  });

  it('issues at once while core lays out a load it has taken', () => {
    const laidOut = run([soft, status('loading'), settled]);
    expect(laidOut.state.inFlight).toBe(false);
    expect(isBusy(laidOut.state)).toBe(true);

    const again = run([status('interactive'), soft], laidOut.state);
    expect(issued(again.effects)).toEqual([false]);
  });

  it('reports loading from the request on, whatever core last said', () => {
    const complete = run([soft, settled, status('complete')]).state;
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
    const idle = run([soft, settled, status('complete')]).state;
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
    expect(run([soft, settled, status('complete')]).effects.at(-1)).toEqual({
      type: 'unwatch',
    });
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
    // for it to settle.
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
