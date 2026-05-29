// biome-ignore lint/suspicious/noExplicitAny: This is a utility function that can accept any type of arguments.
export const debounce = <T extends (...rest: any[]) => unknown>(
  fn: T,
  delay: number,
  options: { leading?: boolean; trailing?: boolean } = {},
): T & { cancel: () => void } => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: unknown[] | null = null;

  const debouncedFn = function (this: unknown, ...args: unknown[]) {
    lastArgs = args;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (options.leading && !timeoutId) {
      fn.apply(this, args);
    }

    timeoutId = setTimeout(() => {
      if (options.trailing && lastArgs) {
        fn.apply(this, lastArgs);
      }
      timeoutId = null;
      lastArgs = null;
    }, delay);
  };

  debouncedFn.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  return debouncedFn as T & { cancel: () => void };
};
