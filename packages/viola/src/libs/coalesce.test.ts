import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { coalesce } from './coalesce';

describe('coalesce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const fn = vi.fn();
    const request = coalesce(fn, { wait: 200, maxWait: 1000 });
    return { fn, request };
  };

  it('runs a request after a quiet spell at once', () => {
    const { fn, request } = setup();
    request();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    request();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('folds a burst into one trailing run once it goes quiet', () => {
    const { fn, request } = setup();
    request();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(50);
      request();
    }
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(199);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs a sustained burst every maxWait', () => {
    const { fn, request } = setup();
    const runs: number[] = [];
    fn.mockImplementation(() => runs.push(Date.now()));
    const start = Date.now();
    request();
    // A held key repeating every 30 ms, released after the request at 2520 ms
    for (let i = 0; i < 84; i++) {
      vi.advanceTimersByTime(30);
      request();
    }
    vi.advanceTimersByTime(200);
    expect(runs.map((at) => at - start)).toEqual([0, 1000, 2000, 2720]);
  });

  it('keeps runs apart by wait', () => {
    const { fn, request } = setup();
    const runs: number[] = [];
    fn.mockImplementation(() => runs.push(Date.now()));
    const start = Date.now();
    request();
    vi.advanceTimersByTime(150);
    request();
    vi.advanceTimersByTime(250);
    request();
    vi.advanceTimersByTime(1000);
    expect(runs.map((at) => at - start)).toEqual([0, 350, 600]);
  });

  it('flushes a waiting request', () => {
    const { fn, request } = setup();
    request();
    request.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    request();
    request.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
