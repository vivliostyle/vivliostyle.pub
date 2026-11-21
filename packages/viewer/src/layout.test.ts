import { describe, expect, it } from 'vitest';

import {
  arrangeScroll,
  arrangeSingle,
  arrangeSpread,
  dominantSpan,
  endOffset,
  fitScale,
  moveTarget,
  offsetFor,
  type PageBox,
  type PageSide,
  pairSpreads,
  resolvePage,
  type ScrollGeometry,
  scrollGap,
  scrollTopFor,
  spreadGap,
} from './layout';

function page(
  spineIndex: number,
  pageIndex: number,
  side: PageSide,
  width = 100,
  height = 150,
): PageBox {
  return { spineIndex, pageIndex, side, width, height };
}

describe('pairSpreads', () => {
  it('shows a first page that is a recto alone (ltr)', () => {
    const { spreads, spreadOf } = pairSpreads(
      ['right', 'left', 'right', 'left', 'right'],
      'ltr',
    );
    expect(spreads).toEqual([[0], [1, 2], [3, 4]]);
    expect(spreadOf).toEqual([0, 1, 1, 2, 2]);
  });

  it('pairs from the right in rtl publications', () => {
    const { spreads } = pairSpreads(['left', 'right', 'left', 'right'], 'rtl');
    expect(spreads).toEqual([[0], [1, 2], [3]]);
  });

  it('pairs a first page that is a verso with the next page', () => {
    const { spreads } = pairSpreads(['left', 'right', 'left'], 'ltr');
    expect(spreads).toEqual([[0, 1], [2]]);
  });

  it('leaves pages unpaired when two of the same side follow each other', () => {
    const { spreads, spreadOf } = pairSpreads(
      ['right', 'right', 'left', 'left', 'right'],
      'ltr',
    );
    expect(spreads).toEqual([[0], [1], [2], [3, 4]]);
    expect(spreadOf).toEqual([0, 1, 2, 3, 3]);
  });

  it('keeps earlier spreads when more pages arrive', () => {
    const sides: PageSide[] = ['right', 'left'];
    expect(pairSpreads(sides, 'ltr').spreads).toEqual([[0], [1]]);
    expect(pairSpreads([...sides, 'right'], 'ltr').spreads).toEqual([
      [0],
      [1, 2],
    ]);
  });

  it('handles no pages', () => {
    expect(pairSpreads([], 'ltr')).toEqual({ spreads: [], spreadOf: [] });
  });
});

describe('arrangeSingle', () => {
  it('places the page at the origin and sizes the content to it', () => {
    const pages = [page(0, 0, 'right'), page(0, 1, 'left', 300, 400)];
    expect(arrangeSingle(pages, 1)).toEqual({
      placements: [{ index: 1, x: 0, y: 0 }],
      width: 300,
      height: 400,
    });
  });
});

describe('arrangeSpread', () => {
  it('puts each page on the slot of its side, around the gutter', () => {
    const pages = [page(0, 0, 'left'), page(0, 1, 'right')];
    expect(arrangeSpread(pages, [0, 1])).toEqual({
      placements: [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 100 + spreadGap, y: 0 },
      ],
      width: 200 + spreadGap,
      height: 150,
    });
  });

  it('places by side, not by reading order (rtl)', () => {
    const pages = [page(0, 0, 'right'), page(0, 1, 'left')];
    expect(arrangeSpread(pages, [0, 1]).placements).toEqual([
      { index: 0, x: 100 + spreadGap, y: 0 },
      { index: 1, x: 0, y: 0 },
    ]);
  });

  it('keeps a lone page on its own side with the other slot empty', () => {
    const pages = [page(0, 0, 'right')];
    expect(arrangeSpread(pages, [0])).toEqual({
      placements: [{ index: 0, x: 100 + spreadGap, y: 0 }],
      width: 200 + spreadGap,
      height: 150,
    });
    const left = [page(0, 0, 'left')];
    expect(arrangeSpread(left, [0]).placements).toEqual([
      { index: 0, x: 0, y: 0 },
    ]);
  });

  it('keeps the gutter centered when the page widths differ', () => {
    const pages = [page(0, 0, 'left', 80, 100), page(0, 1, 'right', 120, 200)];
    expect(arrangeSpread(pages, [0, 1])).toEqual({
      placements: [
        { index: 0, x: 40, y: 0 },
        { index: 1, x: 120 + spreadGap, y: 0 },
      ],
      width: 240 + spreadGap,
      height: 200,
    });
  });
});

describe('arrangeScroll', () => {
  it('stacks pages with a gap and centers narrower ones', () => {
    const pages = [
      page(0, 0, 'right', 100, 150),
      page(0, 1, 'left', 60, 80),
      page(1, 0, 'right', 100, 150),
    ];
    expect(arrangeScroll(pages)).toEqual({
      placements: [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 20, y: 150 + scrollGap },
        { index: 2, x: 0, y: 230 + scrollGap * 2 },
      ],
      width: 100,
      height: 380 + scrollGap * 2,
    });
  });

  it('handles no pages', () => {
    expect(arrangeScroll([])).toEqual({ placements: [], width: 0, height: 0 });
  });
});

describe('fitScale', () => {
  it('stays at 100% while the content fits', () => {
    expect(fitScale(794, 1000)).toBe(1);
    expect(fitScale(794, 794)).toBe(1);
  });

  it('never enlarges', () => {
    expect(fitScale(200, 2000)).toBe(1);
  });

  it('shrinks content wider than the available width', () => {
    expect(fitScale(800, 400)).toBe(0.5);
  });

  it('keeps a lower bound for a collapsed pane', () => {
    expect(fitScale(800, 0)).toBeGreaterThan(0);
    expect(fitScale(800, -32)).toBeGreaterThan(0);
  });

  it('treats empty content as 100%', () => {
    expect(fitScale(0, 400)).toBe(1);
  });
});

describe('scroll offsets', () => {
  const geometry: ScrollGeometry = { originTop: 16, padding: 16, scale: 0.5 };

  it('puts a page top at the top of the padded area for offset 0', () => {
    expect(scrollTopFor(geometry, 0, 0)).toBe(0);
    expect(scrollTopFor(geometry, 1000, 0)).toBe(500);
  });

  it('round-trips between offsets and scroll positions', () => {
    for (const offset of [-40, 0, 123.5]) {
      const scrollTop = scrollTopFor(geometry, 1000, offset);
      expect(offsetFor(geometry, 1000, scrollTop)).toBeCloseTo(offset);
    }
  });

  it('keeps a centered page where it is when the scroll range is zero', () => {
    const centered: ScrollGeometry = { originTop: 216, padding: 16, scale: 1 };
    expect(offsetFor(centered, 0, 0)).toBe(-200);
    expect(scrollTopFor(centered, 0, -200)).toBe(0);
  });

  it('brings the content bottom to the viewport bottom', () => {
    const top: ScrollGeometry = { originTop: 16, padding: 16, scale: 1 };
    // Content 1123 tall in an 800 tall viewport: scroll range 1123 + 32 - 800.
    const offset = endOffset(top, 1123, 800);
    expect(scrollTopFor(top, 0, offset)).toBe(1123 + 32 - 800);
  });
});

describe('dominantSpan', () => {
  const spans = [
    { top: 0, bottom: 100 },
    { top: 110, bottom: 210 },
    { top: 220, bottom: 320 },
  ];

  it('picks the span covering most of the view', () => {
    expect(dominantSpan(spans, 0, 80)).toBe(0);
    expect(dominantSpan(spans, 60, 200)).toBe(1);
    expect(dominantSpan(spans, 190, 320)).toBe(2);
  });

  it('prefers the earlier span on a tie', () => {
    expect(dominantSpan(spans, 0, 210)).toBe(0);
    expect(dominantSpan(spans, -50, 400)).toBe(0);
  });

  it('falls back to the nearest span when none overlaps', () => {
    expect(dominantSpan(spans, 101, 109)).toBe(0);
    expect(dominantSpan(spans, 212, 219)).toBe(2);
    expect(dominantSpan(spans, 500, 600)).toBe(2);
    expect(dominantSpan(spans, -100, -10)).toBe(0);
  });

  it('handles no spans', () => {
    expect(dominantSpan([], 0, 100)).toBeNull();
  });
});

describe('moveTarget', () => {
  const spreadIndex = pairSpreads(
    ['right', 'left', 'right', 'left', 'right'],
    'ltr',
  );

  it('moves by one page in single and scroll modes', () => {
    expect(moveTarget('single', 2, 5, null, 'next')).toBe(3);
    expect(moveTarget('scroll', 2, 5, null, 'prev')).toBe(1);
  });

  it('stops at either end', () => {
    expect(moveTarget('single', 4, 5, null, 'next')).toBeNull();
    expect(moveTarget('single', 0, 5, null, 'prev')).toBeNull();
  });

  it('moves by spread, landing on its first page', () => {
    expect(moveTarget('spread', 0, 5, spreadIndex, 'next')).toBe(1);
    expect(moveTarget('spread', 1, 5, spreadIndex, 'next')).toBe(3);
    expect(moveTarget('spread', 2, 5, spreadIndex, 'next')).toBe(3);
    expect(moveTarget('spread', 4, 5, spreadIndex, 'prev')).toBe(1);
    expect(moveTarget('spread', 2, 5, spreadIndex, 'prev')).toBe(0);
    expect(moveTarget('spread', 3, 5, spreadIndex, 'next')).toBeNull();
    expect(moveTarget('spread', 0, 5, spreadIndex, 'prev')).toBeNull();
  });

  it('goes to the first and last pages', () => {
    expect(moveTarget('spread', 2, 5, spreadIndex, 'first')).toBe(0);
    expect(moveTarget('single', 2, 5, null, 'last')).toBe(4);
  });

  it('has nowhere to go without pages', () => {
    expect(moveTarget('single', 0, 0, null, 'first')).toBeNull();
    expect(moveTarget('single', 0, 0, null, 'next')).toBeNull();
  });
});

describe('resolvePage', () => {
  const keys = [
    { spineIndex: 0, pageIndex: 0 },
    { spineIndex: 0, pageIndex: 1 },
    { spineIndex: 1, pageIndex: 0 },
    { spineIndex: 1, pageIndex: 1 },
  ];

  it('finds the page by its key', () => {
    expect(resolvePage(keys, { spineIndex: 1, pageIndex: 0 }, false)).toBe(2);
  });

  it('waits for a page that may still be laid out', () => {
    expect(resolvePage(keys, { spineIndex: 1, pageIndex: 5 }, false)).toBe(
      null,
    );
    expect(resolvePage(keys, { spineIndex: 3, pageIndex: 0 }, false)).toBe(
      null,
    );
    expect(resolvePage([], { spineIndex: 0, pageIndex: 0 }, true)).toBeNull();
  });

  it('settles on the last page before a page that is gone', () => {
    expect(resolvePage(keys, { spineIndex: 1, pageIndex: 5 }, true)).toBe(3);
    expect(resolvePage(keys, { spineIndex: 0, pageIndex: 7 }, false)).toBe(1);
  });

  it('settles on the first page when nothing comes before the target', () => {
    const later = keys.slice(2);
    expect(resolvePage(later, { spineIndex: 0, pageIndex: 3 }, false)).toBe(0);
  });
});
