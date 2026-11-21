import { describe, expect, it } from 'vitest';

import {
  type PrintEffect,
  type PrintEvent,
  type PrintPhase,
  printErrorTimeout,
  printStallTimeout,
  reducePrint,
} from './print-flow';

function run(events: PrintEvent[], from: PrintPhase = 'preparing') {
  let phase = from;
  const effects: PrintEffect[] = [];
  for (const event of events) {
    const [next, emitted] = reducePrint(phase, event);
    phase = next;
    effects.push(...emitted);
  }
  return { phase, effects };
}

const progress: PrintEvent = { type: 'progress' };
const error: PrintEvent = { type: 'error' };
const timeout: PrintEvent = { type: 'timeout' };
const complete = (pageCount: number): PrintEvent => ({
  type: 'complete',
  pageCount,
});

const prints = (effects: PrintEffect[]) =>
  effects.filter((effect) => effect.type === 'print').length;

describe('reducePrint', () => {
  it('restarts the stall timer on every progress', () => {
    const { phase, effects } = run([progress, progress]);
    expect(phase).toBe('preparing');
    expect(effects).toEqual([
      { type: 'watch', timeout: printStallTimeout },
      { type: 'watch', timeout: printStallTimeout },
    ]);
  });

  it('gives up sooner after an error unless something moves', () => {
    expect(run([progress, error]).effects.at(-1)).toEqual({
      type: 'watch',
      timeout: printErrorTimeout,
    });
    expect(run([progress, error, progress]).effects.at(-1)).toEqual({
      type: 'watch',
      timeout: printStallTimeout,
    });
    expect(run([progress, error, timeout]).phase).toBe('stalled');
  });

  it('prints exactly once when core completes with pages', () => {
    const { phase, effects } = run([
      progress,
      complete(3),
      complete(3),
      progress,
      timeout,
    ]);
    expect(phase).toBe('printing');
    expect(prints(effects)).toBe(1);
    expect(effects.at(-1)).toEqual({ type: 'print' });
  });

  it('fails for good when core completes without a page', () => {
    const { phase, effects } = run([progress, complete(0), complete(2)]);
    expect(phase).toBe('failed');
    expect(prints(effects)).toBe(0);
    expect(effects.at(-1)).toEqual({ type: 'unwatch' });
  });

  it('still prints when a stalled layout completes', () => {
    const stalled = run([progress, timeout]);
    expect(stalled.phase).toBe('stalled');
    expect(run([error], stalled.phase).effects).toEqual([]);

    expect(run([progress], stalled.phase).phase).toBe('preparing');
    const completed = run([complete(1)], stalled.phase);
    expect(completed.phase).toBe('printing');
    expect(prints(completed.effects)).toBe(1);
  });
});
