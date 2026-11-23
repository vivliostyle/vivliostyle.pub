import { describe, expect, it } from 'vitest';

import {
  initialWheelState,
  type KeyInput,
  keyCommand,
  reduceWheel,
  type WheelAction,
  type WheelInput,
  type WheelState,
} from './input';
import type { ScrollDirection } from './scrollable';

describe('keyCommand', () => {
  const paged: Omit<KeyInput, 'key'> = {
    mode: 'single',
    progression: 'ltr',
    canScroll: () => false,
  };
  const scrollable =
    (...directions: ScrollDirection[]) =>
    (direction: ScrollDirection) =>
      directions.includes(direction);

  it('follows the page progression with left and right', () => {
    expect(keyCommand({ ...paged, key: 'ArrowRight' })).toBe('next');
    expect(keyCommand({ ...paged, key: 'ArrowLeft' })).toBe('prev');
    expect(
      keyCommand({ ...paged, progression: 'rtl', key: 'ArrowRight' }),
    ).toBe('prev');
    expect(keyCommand({ ...paged, progression: 'rtl', key: 'ArrowLeft' })).toBe(
      'next',
    );
  });

  it('scrolls a tall page with up and down before turning it', () => {
    expect(
      keyCommand({ ...paged, key: 'ArrowDown', canScroll: scrollable('down') }),
    ).toBeNull();
    expect(keyCommand({ ...paged, key: 'ArrowDown' })).toBe('next');
    expect(
      keyCommand({ ...paged, key: 'ArrowUp', canScroll: scrollable('up') }),
    ).toBeNull();
    expect(keyCommand({ ...paged, key: 'ArrowUp' })).toBe('prevEnd');
  });

  it('scrolls something sideways with left and right before turning', () => {
    const wide = scrollable('left', 'right');
    expect(
      keyCommand({ ...paged, key: 'ArrowRight', canScroll: wide }),
    ).toBeNull();
    expect(
      keyCommand({ ...paged, key: 'ArrowLeft', canScroll: wide }),
    ).toBeNull();
    expect(
      keyCommand({
        ...paged,
        key: 'ArrowLeft',
        canScroll: scrollable('right'),
      }),
    ).toBe('prev');
  });

  it('turns pages with PageUp and PageDown, and jumps with Home and End', () => {
    expect(keyCommand({ ...paged, key: 'PageDown' })).toBe('next');
    expect(keyCommand({ ...paged, key: 'PageUp' })).toBe('prev');
    expect(keyCommand({ ...paged, key: 'Home' })).toBe('first');
    expect(keyCommand({ ...paged, key: 'End' })).toBe('last');
  });

  it('leaves up and down to native scrolling in scroll mode', () => {
    const scroll = { ...paged, mode: 'scroll' as const };
    expect(keyCommand({ ...scroll, key: 'ArrowDown' })).toBeNull();
    expect(keyCommand({ ...scroll, key: 'ArrowUp' })).toBeNull();
    expect(keyCommand({ ...scroll, key: 'PageDown' })).toBe('next');
    expect(keyCommand({ ...scroll, key: 'ArrowRight' })).toBe('next');
  });

  it('ignores other keys', () => {
    expect(keyCommand({ ...paged, key: ' ' })).toBeNull();
    expect(keyCommand({ ...paged, key: 'a' })).toBeNull();
  });
});

function feed(
  inputs: WheelInput[],
  state: WheelState = initialWheelState,
): { actions: WheelAction[]; state: WheelState } {
  const actions: WheelAction[] = [];
  for (const input of inputs) {
    const result = reduceWheel(state, input);
    state = result.state;
    actions.push(result.action);
  }
  return { actions, state };
}

function gesture(
  start: number,
  deltas: number[],
  canScroll: boolean | boolean[] = false,
): WheelInput[] {
  return deltas.map((delta, i) => ({
    time: start + i * 16,
    delta,
    canScroll: Array.isArray(canScroll) ? canScroll[i] : canScroll,
  }));
}

describe('reduceWheel', () => {
  it('leaves scrolling to the browser while the page can scroll', () => {
    expect(feed(gesture(0, [40, 40, 40], true)).actions).toEqual([
      'native',
      'native',
      'native',
    ]);
  });

  it('turns once the gesture has moved far enough at an edge', () => {
    expect(feed(gesture(0, [20, 20, 30])).actions).toEqual([
      'consume',
      'consume',
      'next',
    ]);
    expect(feed(gesture(0, [-100])).actions).toEqual(['prev']);
  });

  it('turns at most one page per gesture, momentum included', () => {
    expect(feed(gesture(0, [100, 100, 80, 40, 10], false)).actions).toEqual([
      'next',
      'consume',
      'consume',
      'consume',
      'consume',
    ]);
  });

  it('swallows what is left of a gesture after a turn, even if the new page scrolls', () => {
    expect(
      feed(gesture(0, [100, 60, 30], [false, true, true])).actions,
    ).toEqual(['next', 'consume', 'consume']);
  });

  it('does not turn with a gesture that ran into the edge while scrolling', () => {
    expect(
      feed(gesture(0, [60, 60, 60, 60], [true, true, false, false])).actions,
    ).toEqual(['native', 'native', 'consume', 'consume']);
  });

  it('starts a new gesture after a pause', () => {
    const first = feed(gesture(0, [100, 50]));
    expect(first.actions).toEqual(['next', 'consume']);
    expect(feed(gesture(1000, [100]), first.state).actions).toEqual(['next']);
  });

  it('restarts the distance when the direction flips', () => {
    expect(feed(gesture(0, [50, -50, -20])).actions).toEqual([
      'consume',
      'consume',
      'prev',
    ]);
  });

  it('ignores movement off the paging axis', () => {
    expect(feed(gesture(0, [0])).actions).toEqual(['native']);
  });
});
