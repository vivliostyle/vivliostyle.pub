import type { PageProgression, ViewMode } from './protocol';
import type { ScrollDirection } from './scrollable';

/** `prevEnd` lands on the previous page scrolled to its end. */
export type PageCommand = 'next' | 'prev' | 'prevEnd' | 'first' | 'last';

export interface KeyInput {
  key: string;
  mode: ViewMode;
  progression: PageProgression;
  /** Whether the key's target, or a scroll container around it, can scroll. */
  canScroll: (direction: ScrollDirection) => boolean;
}

/** The page command a key stands for, or null to leave the key to the browser. */
export function keyCommand({
  key,
  mode,
  progression,
  canScroll,
}: KeyInput): PageCommand | null {
  // Arrow keys scroll whatever can still scroll their way, and turn the page
  // only at its edge; in scroll mode up and down always just scroll.
  switch (key) {
    case 'ArrowLeft':
      return canScroll('left') ? null : progression === 'rtl' ? 'next' : 'prev';
    case 'ArrowRight':
      return canScroll('right')
        ? null
        : progression === 'rtl'
          ? 'prev'
          : 'next';
    case 'ArrowDown':
      return mode === 'scroll' || canScroll('down') ? null : 'next';
    case 'ArrowUp':
      return mode === 'scroll' || canScroll('up') ? null : 'prevEnd';
    case 'PageDown':
      return 'next';
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

export interface WheelState {
  lastTime: number;
  direction: number;
  accumulated: number;
  /** The current gesture scrolled the page natively. */
  scrolled: boolean;
  /** The current gesture already turned a page. */
  turned: boolean;
}

export const initialWheelState: WheelState = {
  lastTime: Number.NEGATIVE_INFINITY,
  direction: 0,
  accumulated: 0,
  scrolled: false,
  turned: false,
};

export interface WheelInput {
  time: number;
  /** Distance along the paging axis in screen px; positive moves forward. */
  delta: number;
  /** The viewport can still scroll natively in the direction of `delta`. */
  canScroll: boolean;
}

/** `native` leaves the event to the browser; `consume` cancels it. */
export type WheelAction = 'native' | 'consume' | 'next' | 'prev';

// Wheel events less than this far apart belong to one gesture, momentum
// scrolling included.
const gestureGap = 200;
const turnThreshold = 60;

/**
 * Turns at most one page per gesture, and none with a gesture that scrolled
 * the page: momentum running into a page end must not turn pages.
 */
export function reduceWheel(
  state: WheelState,
  { time, delta, canScroll }: WheelInput,
): { state: WheelState; action: WheelAction } {
  const next: WheelState =
    time - state.lastTime > gestureGap
      ? { ...initialWheelState, lastTime: time }
      : { ...state, lastTime: time };
  if (delta === 0) {
    return { state: next, action: 'native' };
  }
  if (next.turned) {
    return { state: next, action: 'consume' };
  }
  if (canScroll) {
    return {
      state: { ...next, scrolled: true, accumulated: 0 },
      action: 'native',
    };
  }
  if (next.scrolled) {
    return { state: next, action: 'consume' };
  }
  const direction = Math.sign(delta);
  const accumulated =
    (direction === next.direction ? next.accumulated : 0) + Math.abs(delta);
  if (accumulated >= turnThreshold) {
    return {
      state: { ...next, direction, accumulated: 0, turned: true },
      action: direction > 0 ? 'next' : 'prev',
    };
  }
  return { state: { ...next, direction, accumulated }, action: 'consume' };
}
