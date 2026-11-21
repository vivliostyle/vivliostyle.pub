export interface Coalesced {
  (): void;
  /** Runs a request that is still waiting, right away. */
  flush(): void;
}

/**
 * Runs `fn` at once for a request that follows a quiet spell, and folds the
 * requests of a burst into one trailing run `wait` ms after the burst goes
 * quiet, or `maxWait` ms after the previous run at the latest. Unless flushed,
 * runs stay at least `min(wait, maxWait)` ms apart.
 */
export function coalesce(
  fn: () => void,
  {
    wait,
    maxWait = Number.POSITIVE_INFINITY,
  }: { wait: number; maxWait?: number },
): Coalesced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let lastRun = 0;

  const arm = () => {
    clearTimeout(timer);
    const delay = Math.min(wait, lastRun + maxWait - Date.now());
    timer = setTimeout(handleTimeout, Math.max(0, delay));
  };
  const run = () => {
    pending = false;
    lastRun = Date.now();
    arm();
    fn();
  };
  const handleTimeout = () => {
    timer = undefined;
    if (pending) {
      run();
    }
  };

  const request = () => {
    if (timer === undefined) {
      run();
    } else {
      pending = true;
      arm();
    }
  };
  request.flush = () => {
    if (pending) {
      run();
    }
  };
  return request;
}
