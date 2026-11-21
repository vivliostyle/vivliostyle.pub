import { proxy } from 'valtio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { awaiter } from './awaiter';

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('awaiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves right away when the value is already there', async () => {
    const state = proxy({ value: 'ready' as string | null });

    await expect(
      awaiter({ watch: state, getter: () => state.value, name: 'value' }),
    ).resolves.toBe('ready');
  });

  // Fake timers are never advanced here, so only the subscription can settle it.
  it('resolves when a nested change makes the value appear', async () => {
    const state = proxy({ nested: { value: null as number | null } });
    const promise = awaiter({
      watch: state,
      getter: () => state.nested.value,
      name: 'nested value',
    });

    state.nested.value = 0;

    await expect(promise).resolves.toBe(0);
  });

  it('waits without a deadline unless given a timeout', async () => {
    const state = proxy({ value: null as string | null });
    const settled = vi.fn();
    awaiter({ watch: state, getter: () => state.value, name: 'value' }).then(
      settled,
      settled,
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(settled).not.toHaveBeenCalled();
  });

  it('rejects once the timeout passes', async () => {
    const state = proxy({ value: null as string | null });
    const promise = awaiter({
      watch: state,
      getter: () => state.value,
      name: 'value',
      timeout: 1_000,
    });
    const assertion = expect(promise).rejects.toThrowError(
      'Awaiter timeout: value',
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
  });

  it('rejects when aborted, before or while waiting', async () => {
    const state = proxy({ value: null as string | null });
    await expect(
      awaiter({
        watch: state,
        getter: () => state.value,
        name: 'value',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrowError('Awaiter aborted: value');

    const controller = new AbortController();
    const promise = awaiter({
      watch: state,
      getter: () => state.value,
      name: 'value',
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrowError('Awaiter aborted: value');
  });

  it('rejects with the error the getter throws', async () => {
    const state = proxy({ broken: false });
    const promise = awaiter({
      watch: state,
      getter: () => {
        if (state.broken) {
          throw new Error('broken');
        }
        return null;
      },
      name: 'value',
    });

    state.broken = true;

    await expect(promise).rejects.toThrowError('broken');
  });

  it('stops watching once settled', async () => {
    const state = proxy({ value: null as string | null });
    const getter = vi.fn(() => state.value);
    const promise = awaiter({ watch: state, getter, name: 'value' });
    state.value = 'ready';
    await promise;
    const calls = getter.mock.calls.length;

    state.value = 'changed';
    await flush();

    expect(getter).toHaveBeenCalledTimes(calls);
  });
});
