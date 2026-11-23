import { describe, expect, it } from 'vitest';

import {
  canScrollToward,
  type ScrollBox,
  type ScrollStyle,
} from './scrollable';

interface FakeBox extends ScrollBox {
  style: ScrollStyle;
}

function box(
  geometry: Partial<Omit<ScrollBox, 'parentElement'>>,
  style: Partial<ScrollStyle> = {},
  parentElement: FakeBox | null = null,
): FakeBox {
  return {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 100,
    scrollWidth: 100,
    clientHeight: 100,
    clientWidth: 100,
    parentElement,
    ...geometry,
    style: {
      overflowX: 'visible',
      overflowY: 'visible',
      writingMode: 'horizontal-tb',
      direction: 'ltr',
      ...style,
    },
  };
}

const styleOf = (target: ScrollBox) => (target as FakeBox).style;

describe('canScrollToward', () => {
  const viewport = box(
    { scrollHeight: 2000, clientHeight: 800, scrollTop: 0 },
    { overflowX: 'auto', overflowY: 'auto' },
  );

  it('checks the viewport for a target that does not scroll itself', () => {
    const text = box({}, {}, viewport);
    expect(canScrollToward(text, viewport, 'down', styleOf)).toBe(true);
    expect(canScrollToward(text, viewport, 'up', styleOf)).toBe(false);
    expect(canScrollToward(text, viewport, 'right', styleOf)).toBe(false);
  });

  it('lets a scrollable element inside a page scroll first', () => {
    const pre = box(
      { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 },
      { overflowX: 'auto' },
      viewport,
    );
    const code = box({}, {}, pre);
    expect(canScrollToward(code, viewport, 'right', styleOf)).toBe(true);
    expect(canScrollToward(code, viewport, 'left', styleOf)).toBe(false);
  });

  it('ignores overflow that the user cannot scroll', () => {
    const clipped = box(
      { scrollHeight: 500, clientHeight: 100, scrollTop: 0 },
      { overflowY: 'hidden' },
      box({}, {}, null),
    );
    const top = box({ scrollTop: 0 }, { overflowY: 'auto' });
    expect(canScrollToward(clipped, top, 'down', styleOf)).toBe(false);
  });

  it('stops at its edges, rounding a pixel either way', () => {
    const atEnd = box(
      { scrollHeight: 500, clientHeight: 100, scrollTop: 399.5 },
      { overflowY: 'auto' },
    );
    expect(canScrollToward(atEnd, atEnd, 'down', styleOf)).toBe(false);
    expect(canScrollToward(atEnd, atEnd, 'up', styleOf)).toBe(true);
  });

  it('reads negative positions of boxes that start at the right', () => {
    const vertical = box(
      { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 },
      { overflowX: 'auto', writingMode: 'vertical-rl' },
    );
    expect(canScrollToward(vertical, vertical, 'left', styleOf)).toBe(true);
    expect(canScrollToward(vertical, vertical, 'right', styleOf)).toBe(false);
    const scrolled = { ...vertical, scrollLeft: -300 };
    expect(canScrollToward(scrolled, scrolled, 'left', styleOf)).toBe(false);
    expect(canScrollToward(scrolled, scrolled, 'right', styleOf)).toBe(true);
    const rtl = box(
      { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 },
      { overflowX: 'auto', direction: 'rtl' },
    );
    expect(canScrollToward(rtl, rtl, 'left', styleOf)).toBe(true);
  });

  it('treats a target outside the viewport as the viewport', () => {
    const body = box({}, {}, null);
    expect(canScrollToward(body, viewport, 'down', styleOf)).toBe(true);
    expect(canScrollToward(null, viewport, 'down', styleOf)).toBe(true);
  });
});
