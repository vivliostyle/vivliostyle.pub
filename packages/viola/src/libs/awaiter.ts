export const awaiter = async <T>({
  getter,
  name,
  abortSignal,
}: {
  getter: () => T | Promise<NonNullable<T>>;
  name: string;
  abortSignal?: AbortSignal;
}): Promise<NonNullable<T>> => {
  const now = performance.now();
  return new Promise((resolve, reject) => {
    const loop = () => {
      if (abortSignal?.aborted) {
        return reject(new Error(`Awaiter aborted: ${name}`));
      }
      try {
        const value = getter();
        if (value instanceof Promise) {
          value.then((v) => resolve(v)).catch(reject);
          return;
        } else if (value != null) {
          return resolve(value);
        }
      } catch (error) {
        return reject(error);
      }
      if (performance.now() - now > 10_000) {
        // timeout
        return reject(new Error(`Awaiter timeout: ${name}`));
      }
      // Poll via setTimeout, not requestAnimationFrame: rAF is paused while the
      // document is hidden, which would stall this loop — and its timeout — until
      // the tab is shown again.
      setTimeout(loop, 50);
    };
    loop();
  });
};
