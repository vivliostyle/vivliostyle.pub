import {
  Activity,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface PrerenderOptions {
  /** Views kept mounted, the shown one included. */
  capacity?: number;
  /**
   * How long the pointer or focus rests on a trigger before its view starts
   * rendering, long enough to skip the triggers it only passes over.
   */
  delay?: number;
  /** The kept views are dropped whenever this changes, e.g. with a filter. */
  resetKey?: string;
}

export interface Prerender<K extends string> {
  /** The views to render, in an order that does not move them around. */
  keys: readonly K[];
  /** Starts rendering the view of `key`, hidden, after the delay. */
  prerender: (key: K) => void;
  /** Drops a prerender that has not started yet. */
  cancel: () => void;
  /** Handlers for a trigger that shows the view of `key`. */
  triggerProps: (key: K) => PrerenderTriggerProps;
}

export interface PrerenderTriggerProps {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/** Puts `current` first and drops the views used longest ago. */
export function showView<K>(
  keys: readonly K[],
  current: K,
  capacity: number,
): readonly K[] {
  return [current, ...keys.filter((key) => key !== current)].slice(0, capacity);
}

/** Adds `key` right after the shown view, which must stay. */
export function addPrerenderedView<K>(
  keys: readonly K[],
  key: K,
  capacity: number,
): readonly K[] {
  if (keys.includes(key)) {
    return keys;
  }
  return [...keys.slice(0, 1), key, ...keys.slice(1)].slice(0, capacity);
}

/**
 * Keeps the views shown lately mounted while hidden, and starts rendering the
 * view of a trigger that the pointer or focus rests on, so that switching to
 * either skips most of the mounting. Render the views with
 * `PrerenderedViews`.
 */
export function usePrerender<K extends string>(
  current: K,
  { capacity = 6, delay = 100, resetKey = '' }: PrerenderOptions = {},
): Prerender<K> {
  const [state, setState] = useState(() => ({
    resetKey,
    keys: [current] as readonly K[],
  }));
  let keys = state.resetKey === resetKey ? state.keys : [];
  if (keys[0] !== current) {
    keys = showView(keys, current, capacity);
    setState({ resetKey, keys });
  }

  const optionsRef = useRef({ capacity, delay, resetKey });
  useLayoutEffect(() => {
    optionsRef.current = { capacity, delay, resetKey };
  });
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const cancel = useCallback(() => clearTimeout(timerRef.current), []);
  const prerender = useCallback((key: K) => {
    clearTimeout(timerRef.current);
    const { delay, resetKey } = optionsRef.current;
    timerRef.current = setTimeout(
      () =>
        // Only adds a hidden boundary; React renders hidden views at the
        // lowest priority, after everything shown.
        startTransition(() =>
          setState((prev) =>
            prev.resetKey === resetKey
              ? {
                  ...prev,
                  keys: addPrerenderedView(
                    prev.keys,
                    key,
                    optionsRef.current.capacity,
                  ),
                }
              : prev,
          ),
        ),
      delay,
    );
  }, []);
  const triggerProps = useCallback(
    (key: K): PrerenderTriggerProps => ({
      onPointerEnter: () => prerender(key),
      onPointerLeave: cancel,
      onFocus: () => prerender(key),
      onBlur: cancel,
    }),
    [prerender, cancel],
  );

  const sortedKeys = useMemo(() => [...keys].sort(), [keys]);
  return { keys: sortedKeys, prerender, cancel, triggerProps };
}

/**
 * Renders the view of each key, showing only `current`. The others stay
 * mounted but hidden: their effects are cleaned up and their updates wait
 * until nothing shown has work left.
 */
export function PrerenderedViews<K extends string>({
  current,
  keys,
  children,
}: {
  current: K;
  keys: readonly K[];
  children: (key: K) => React.ReactNode;
}) {
  return keys.map((key) => (
    <Activity key={key} mode={key === current ? 'visible' : 'hidden'}>
      {children(key)}
    </Activity>
  ));
}
