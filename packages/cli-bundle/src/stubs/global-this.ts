import _process from './node/process';

// Resolve the real global object via `Function`; the bundler-time `inject`
// pass rewrites every literal `globalThis` identifier into the default import
// of *this* file, so writing it directly here would create a self-reference.
const root = new Function('return globalThis')() as typeof globalThis;

// @ts-ignore
root.process = _process;

// Vite 8's bundled chunks call `setTimeout(...).unref()` to opt timers out of
// keeping the event loop alive. Browsers return a numeric timer id with no
// such method. Wrap the platform timers so the returned handle quacks like a
// Node `Timeout`. The original numeric id is preserved on `__id__` and used
// by `clearTimeout`/`clearInterval` so we don't break anything.
const wrapTimer = <Args extends unknown[]>(
  fn: (
    handler: (...args: Args) => void,
    timeout?: number,
    ...args: Args
  ) => number,
) => {
  return (
    handler: (...args: Args) => void,
    timeout?: number,
    ...args: Args
  ) => {
    const id = fn(handler, timeout, ...args);
    return {
      __id__: id,
      ref() {
        return this;
      },
      unref() {
        return this;
      },
      hasRef() {
        return true;
      },
      refresh() {
        return this;
      },
      [Symbol.toPrimitive]() {
        return id;
      },
    };
  };
};
const wrapClear =
  (fn: (id: number | undefined) => void) =>
  (handle: number | { __id__: number } | undefined) => {
    if (handle == null) return fn(undefined);
    if (typeof handle === 'number') return fn(handle);
    return fn(handle.__id__);
  };
// @ts-ignore — runtime shape mismatch with the browser lib types is intentional
root.setTimeout = wrapTimer(root.setTimeout.bind(root));
// @ts-ignore
root.setInterval = wrapTimer(root.setInterval.bind(root));
// @ts-ignore
root.clearTimeout = wrapClear(root.clearTimeout.bind(root));
// @ts-ignore
root.clearInterval = wrapClear(root.clearInterval.bind(root));

export default root;
