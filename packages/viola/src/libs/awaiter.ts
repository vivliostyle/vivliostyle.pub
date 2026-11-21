export interface AwaiterOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export function awaiter<T>({
  subscribe,
  getter,
  name,
  timeout,
  signal,
}: {
  subscribe: (onChange: () => void) => () => void;
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
    unsubscribe = subscribe(check);
    // A source that reports while subscribing settles before its unsubscribe
    // exists, so `finish` could not call it.
    if (done) {
      unsubscribe();
      return;
    }
    signal?.addEventListener('abort', onAbort);
    if (timeout !== undefined) {
      timer = setTimeout(() => {
        finish(() => reject(new Error(`Awaiter timeout: ${name}`)));
      }, timeout);
    }
  });
}
