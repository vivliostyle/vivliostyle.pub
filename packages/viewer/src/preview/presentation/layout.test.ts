import { describe, expect, it } from 'vitest';

import type { PageKey } from '../../core/page-key';
import type { ViewMode } from '../../protocol';
import {
  arrangeScroll,
  arrangeSingle,
  arrangeSpread,
  coversView,
  dominantSpan,
  endOffset,
  firstPageAfter,
  locatePage,
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
  viewedPage,
  zoomScale,
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

describe('zoomScale', () => {
  const available = { width: 400, height: 300 };

  it('shows a fixed zoom at its scale', () => {
    expect(zoomScale(1.5, { width: 100, height: 100 }, available)).toBe(1.5);
  });

  it('fits the width, enlarging as well as shrinking', () => {
    expect(zoomScale('fit-width', { width: 800, height: 100 }, available)).toBe(
      0.5,
    );
    expect(zoomScale('fit-width', { width: 200, height: 900 }, available)).toBe(
      2,
    );
  });

  it('fits a page by the side that is tighter', () => {
    expect(zoomScale('fit-page', { width: 200, height: 600 }, available)).toBe(
      0.5,
    );
    expect(zoomScale('fit-page', { width: 800, height: 100 }, available)).toBe(
      0.5,
    );
    expect(zoomScale('fit-page', { width: 100, height: 100 }, available)).toBe(
      3,
    );
  });

  it('stays at 100% without content', () => {
    expect(zoomScale('fit-page', { width: 0, height: 0 }, available)).toBe(1);
  });

  it('never shrinks to nothing', () => {
    expect(
      zoomScale(
        'fit-width',
        { width: 800, height: 100 },
        { width: 0, height: 0 },
      ),
    ).toBeGreaterThan(0);
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

describe('coversView', () => {
  const extent = {
    progression: 'ltr',
    complete: false,
    offset: 0,
    viewHeight: 200,
  } as const;
  const spreadPages = [
    page(0, 0, 'right'),
    page(0, 1, 'left'),
    page(0, 2, 'right'),
    page(0, 3, 'left'),
  ];

  it('is covered by the page itself in single mode', () => {
    expect(
      coversView([page(0, 0, 'right')], 0, { ...extent, mode: 'single' }),
    ).toBe(true);
  });

  it('waits for the recto that pairs with the last verso in spread mode', () => {
    const spread = { ...extent, mode: 'spread' } as const;
    expect(coversView(spreadPages, 1, spread)).toBe(true);
    expect(coversView(spreadPages, 2, spread)).toBe(true);
    expect(coversView(spreadPages, 3, spread)).toBe(false);
    expect(coversView(spreadPages, 3, { ...spread, complete: true })).toBe(
      true,
    );
  });

  it('pairs by the progression of the publication', () => {
    const rtl = { ...extent, mode: 'spread', progression: 'rtl' } as const;
    expect(coversView(spreadPages, 3, rtl)).toBe(true);
    expect(coversView(spreadPages.slice(0, 3), 2, rtl)).toBe(false);
  });

  it('needs the pages down to the bottom of the view in scroll mode', () => {
    const scroll = { ...extent, mode: 'scroll' } as const;
    const pages = [page(0, 0, 'right'), page(0, 1, 'left')];
    // The view runs from 100 to 300 in the first page, which ends at 150; the
    // second page starts after the gap.
    expect(coversView(pages, 0, { ...scroll, offset: 100 })).toBe(true);
    expect(coversView(pages.slice(0, 1), 0, { ...scroll, offset: 100 })).toBe(
      false,
    );
    expect(
      coversView(pages, 0, {
        ...scroll,
        offset: 2 * 150 + scrollGap - 200 + 1,
      }),
    ).toBe(false);
    expect(coversView(pages, 1, { ...scroll, offset: -50 })).toBe(true);
  });

  it('is covered once the layout is complete', () => {
    expect(
      coversView([page(0, 0, 'right')], 0, {
        ...extent,
        mode: 'scroll',
        complete: true,
        offset: 1000,
      }),
    ).toBe(true);
  });

  it('waits while a page in view is unsettled', () => {
    const unsettled = (index: number) => index === 1;
    expect(
      coversView(spreadPages, 0, { ...extent, mode: 'single', unsettled }),
    ).toBe(true);
    expect(
      coversView(spreadPages, 1, { ...extent, mode: 'single', unsettled }),
    ).toBe(false);
    // Page 2 is the recto of the spread that page 1 opens.
    expect(
      coversView(spreadPages, 2, { ...extent, mode: 'spread', unsettled }),
    ).toBe(false);
    expect(
      coversView(spreadPages, 3, {
        ...extent,
        mode: 'spread',
        unsettled,
        complete: true,
      }),
    ).toBe(true);
  });

  it('checks every page the scrolled view shows', () => {
    const scroll = { ...extent, mode: 'scroll' } as const;
    const pages = [
      page(0, 0, 'right'),
      page(0, 1, 'left'),
      page(0, 2, 'right'),
    ];
    const unsettled = (index: number) => index === 0;
    expect(coversView(pages, 1, { ...scroll, unsettled })).toBe(true);
    // Starting below the top of the view, page 1 leaves page 0 in view.
    expect(coversView(pages, 1, { ...scroll, offset: -50, unsettled })).toBe(
      false,
    );
    expect(
      coversView(pages, 1, {
        ...scroll,
        offset: 100,
        unsettled: (index) => index === 2,
      }),
    ).toBe(false);
  });
});

// What the presentation does while stale pages are shown: moves act on the
// stale pages, and the new ones replace them once they cover the target.
describe('a reload in progress', () => {
  const sides: PageSide[] = ['right', 'left', 'right', 'left', 'right', 'left'];
  const stalePages = sides.map((side, i) => page(0, i, side));
  const live = (count: number) => stalePages.slice(0, count);
  const covered = (
    pages: readonly PageBox[],
    target: PageKey,
    mode: ViewMode,
    { complete = false, offset = 0, viewHeight = 200 } = {},
  ) => {
    const index = resolvePage(pages, target, complete);
    return (
      index !== null &&
      coversView(pages, index, {
        mode,
        progression: 'ltr',
        complete,
        offset,
        viewHeight,
      })
    );
  };

  it('waits for the page a move during the reload landed on', () => {
    const next = moveTarget('single', 2, stalePages.length, null, 'next');
    expect(next).toBe(3);
    const target = { spineIndex: 0, pageIndex: 3 };
    expect(covered(live(3), target, 'single')).toBe(false);
    expect(covered(live(4), target, 'single')).toBe(true);
  });

  it('waits for the whole spread after a switch to spread mode', () => {
    const target = { spineIndex: 0, pageIndex: 1 };
    expect(covered(live(2), target, 'single')).toBe(true);
    expect(covered(live(2), target, 'spread')).toBe(false);
    expect(covered(live(3), target, 'spread')).toBe(true);
  });

  it('lands on the last page before a target the edit removed', () => {
    const target = { spineIndex: 0, pageIndex: 5 };
    const shorter = [...live(3), page(1, 0, 'right')];
    expect(covered(live(3), target, 'single')).toBe(false);
    expect(resolvePage(shorter, target, false)).toBe(2);
    expect(covered(shorter, target, 'single')).toBe(true);
    expect(covered(live(3), target, 'single', { complete: true })).toBe(true);
  });

  it('needs more pages in scroll mode once the pane grows taller', () => {
    const target = { spineIndex: 0, pageIndex: 1 };
    expect(covered(live(3), target, 'scroll', { viewHeight: 200 })).toBe(true);
    expect(covered(live(3), target, 'scroll', { viewHeight: 400 })).toBe(false);
    expect(covered(live(4), target, 'scroll', { viewHeight: 400 })).toBe(true);
  });
});

describe('firstPageAfter', () => {
  const keys = [
    { spineIndex: 0, pageIndex: 0 },
    { spineIndex: 0, pageIndex: 1 },
    { spineIndex: 1, pageIndex: 0 },
    { spineIndex: 2, pageIndex: 0 },
  ];

  it('finds the first page past the key', () => {
    expect(firstPageAfter(keys, { spineIndex: 0, pageIndex: 1 })).toBe(2);
    expect(firstPageAfter(keys, { spineIndex: 0, pageIndex: 7 })).toBe(2);
    expect(firstPageAfter(keys, { spineIndex: 1, pageIndex: 3 })).toBe(3);
  });

  it('is the end when nothing comes after the key', () => {
    expect(firstPageAfter(keys, { spineIndex: 2, pageIndex: 0 })).toBe(4);
    expect(firstPageAfter([], { spineIndex: 0, pageIndex: 0 })).toBe(0);
  });

  // An edit lands while core is still laying out the previous one: the pages
  // it has laid out so far are followed by the rest of the rendering before.
  it('fills a partial layout in from the rendering before it', () => {
    const before = [0, 1, 2, 3, 4, 5].map((i) =>
      page(i < 3 ? 0 : 1, i < 3 ? i : i - 3, 'right'),
    );
    const partial = [page(0, 0, 'right'), page(0, 1, 'right')];
    const from = firstPageAfter(before, partial[1]);
    expect([...partial, ...before.slice(from)]).toHaveLength(before.length);

    // The edit added a page to the first spine item.
    const longer = [...partial, page(0, 2, 'right'), page(0, 3, 'right')];
    expect(firstPageAfter(before, longer[3])).toBe(3);
  });
});

describe('locatePage', () => {
  const pages = [
    page(0, 0, 'right'),
    page(0, 1, 'left'),
    page(1, 0, 'right'),
    page(1, 1, 'left'),
  ];

  it('finds a page core replaced in place by its key', () => {
    // A replacement container takes the place of the old one, so the keys
    // counted from the containers are the same as before.
    const replaced = pages.map((p) => ({ ...p, height: p.height + 10 }));
    expect(
      locatePage(replaced, { spineIndex: 1, pageIndex: 0 }, false),
    ).toEqual({ index: 2, settled: true });
  });

  it('stands in the page before a target core took away for the time being', () => {
    // Core took the following spine items away to lay them out again.
    const retired = pages.slice(0, 2);
    expect(locatePage(retired, { spineIndex: 1, pageIndex: 1 }, false)).toEqual(
      { index: 1, settled: false },
    );
    expect(resolvePage(retired, { spineIndex: 1, pageIndex: 1 }, false)).toBe(
      null,
    );
  });

  it('settles on the page before once the target cannot come back', () => {
    expect(locatePage(pages, { spineIndex: 0, pageIndex: 5 }, false)).toEqual({
      index: 1,
      settled: true,
    });
    expect(
      locatePage(pages.slice(0, 2), { spineIndex: 1, pageIndex: 1 }, true),
    ).toEqual({ index: 1, settled: true });
  });

  it('stands in the first page when nothing comes before the target', () => {
    expect(
      locatePage(pages.slice(2), { spineIndex: 0, pageIndex: 0 }, false),
    ).toEqual({ index: 0, settled: true });
    expect(locatePage([], { spineIndex: 0, pageIndex: 0 }, false)).toBeNull();
  });
});

describe('viewedPage', () => {
  const spans = [
    { top: 0, bottom: 100 },
    { top: 110, bottom: 210 },
  ];

  it('is the dominant page while the target is shown', () => {
    expect(viewedPage(spans, 150, 250, true)).toBe(1);
    expect(viewedPage(spans, 400, 500, true)).toBe(1);
  });

  it('names no page for a view of none while the target is missing', () => {
    expect(viewedPage(spans, 150, 250, false)).toBe(1);
    expect(viewedPage(spans, 400, 500, false)).toBeNull();
    expect(viewedPage([], 0, 100, false)).toBeNull();
  });
});
