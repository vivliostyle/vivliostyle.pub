import { subscribe } from 'valtio';

export interface AwaiterOptions {
  timeout?: number;
  signal?: AbortSignal;
}

// Resolves with the first non-nullish value of `getter`, re-evaluated whenever
// `watch` (a valtio proxy, observed deeply) changes. Waits indefinitely unless
// a timeout or signal is given.
export function awaiter<T>({
  watch,
  getter,
  name,
  timeout,
  signal,
}: {
  watch: object;
  getter: () => T | null | undefined;
  name: string;
} & AwaiterOptions): Promise<NonNullable<T>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`Awaiter aborted: ${name}`));
      return;
    }
    let done = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      finish(() => reject(new Error(`Awaiter aborted: ${name}`)));
    };
    const finish = (settle: () => void) => {
      done = true;
      unsubscribe();
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const check = () => {
      if (done) {
        return;
      }
      let value: T | null | undefined;
      try {
        value = getter();
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      if (value != null) {
        finish(() => resolve(value));
      }
    };

    check();
    if (done) {
      return;
    }
    unsubscribe = subscribe(watch, check);
    signal?.addEventListener('abort', onAbort);
    if (timeout !== undefined) {
      timer = setTimeout(() => {
        finish(() => reject(new Error(`Awaiter timeout: ${name}`)));
      }, timeout);
    }
  });
}
