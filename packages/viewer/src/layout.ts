import type { PageProgression, ViewMode } from './protocol';

// Pure geometry of the presentation layer. Lengths are in page CSS px (the
// unit core lays pages out in) unless a name says otherwise; the display scale
// turns them into screen px.

export type PageSide = 'left' | 'right';

/** Identifies a page across re-layouts, the way core addresses it. */
export interface PageKey {
  spineIndex: number;
  /** Index within the spine item. */
  pageIndex: number;
}

export interface PageBox extends PageKey {
  side: PageSide;
  width: number;
  height: number;
}

/** Indices of a spread's pages, in reading order. */
export type Spread = readonly [number] | readonly [number, number];

export interface SpreadIndex {
  spreads: Spread[];
  /** Index into `spreads` for each page. */
  spreadOf: number[];
}

export interface Placement {
  index: number;
  x: number;
  y: number;
}

export interface Arrangement {
  placements: Placement[];
  width: number;
  height: number;
}

export const spreadGap = 2;
export const scrollGap = 16;
const minScale = 0.05;

function versoSide(progression: PageProgression): PageSide {
  return progression === 'rtl' ? 'right' : 'left';
}

/**
 * Pairs each verso with the recto that follows it; any other page stands
 * alone, so a publication that opens on a recto shows its first page by
 * itself.
 */
export function pairSpreads(
  sides: readonly PageSide[],
  progression: PageProgression,
): SpreadIndex {
  const verso = versoSide(progression);
  const spreads: Spread[] = [];
  const spreadOf: number[] = [];
  let i = 0;
  while (i < sides.length) {
    if (sides[i] === verso && i + 1 < sides.length && sides[i + 1] !== verso) {
      spreadOf.push(spreads.length, spreads.length);
      spreads.push([i, i + 1]);
      i += 2;
    } else {
      spreadOf.push(spreads.length);
      spreads.push([i]);
      i += 1;
    }
  }
  return { spreads, spreadOf };
}

export function arrangeSingle(
  pages: readonly PageBox[],
  index: number,
): Arrangement {
  const page = pages[index];
  return {
    placements: [{ index, x: 0, y: 0 }],
    width: page.width,
    height: page.height,
  };
}

/**
 * Two equal slots around a centered gutter, each page on the slot of its side.
 * A lone page leaves the other slot empty, so the gutter and the display scale
 * stay put from spread to spread.
 */
export function arrangeSpread(
  pages: readonly PageBox[],
  spread: Spread,
): Arrangement {
  const slotWidth = Math.max(...spread.map((index) => pages[index].width));
  return {
    placements: spread.map((index) => ({
      index,
      x:
        pages[index].side === 'left'
          ? slotWidth - pages[index].width
          : slotWidth + spreadGap,
      y: 0,
    })),
    width: slotWidth * 2 + spreadGap,
    height: Math.max(...spread.map((index) => pages[index].height)),
  };
}

export function arrangeScroll(pages: readonly PageBox[]): Arrangement {
  const width = Math.max(0, ...pages.map((page) => page.width));
  const placements: Placement[] = [];
  let y = 0;
  pages.forEach((page, index) => {
    if (index > 0) {
      y += scrollGap;
    }
    placements.push({ index, x: (width - page.width) / 2, y });
    y += page.height;
  });
  return { placements, width, height: y };
}

/** 100%, shrunk only as far as needed to fit `availableWidth` (screen px). */
export function fitScale(contentWidth: number, availableWidth: number): number {
  if (contentWidth <= 0 || availableWidth >= contentWidth) {
    return 1;
  }
  return Math.max(minScale, availableWidth / contentWidth);
}

export interface ScrollGeometry {
  /** Top of the scaled content in the scroll container's coordinates. */
  originTop: number;
  padding: number;
  scale: number;
}

// An offset is the distance in page px from a page's top edge to the top of
// the viewport's padded area; negative while the page starts below that edge.
// Kept in page px, it means the same spot after the scale changes.

export function scrollTopFor(
  geometry: ScrollGeometry,
  pageY: number,
  offset: number,
): number {
  return (
    geometry.originTop - geometry.padding + (pageY + offset) * geometry.scale
  );
}

export function offsetFor(
  geometry: ScrollGeometry,
  pageY: number,
  scrollTop: number,
): number {
  return (
    (scrollTop - geometry.originTop + geometry.padding) / geometry.scale - pageY
  );
}

/** The offset that brings the bottom of the content to the viewport's bottom. */
export function endOffset(
  geometry: ScrollGeometry,
  contentHeight: number,
  viewportHeight: number,
): number {
  return (
    contentHeight - (viewportHeight - geometry.padding * 2) / geometry.scale
  );
}

export interface Span {
  top: number;
  bottom: number;
}

/**
 * The span covering most of `[viewTop, viewBottom]`, the earlier one on a tie;
 * when none overlaps, the one nearest to the view. `spans` must be sorted and
 * must not overlap.
 */
export function dominantSpan(
  spans: readonly Span[],
  viewTop: number,
  viewBottom: number,
): number | null {
  if (spans.length === 0) {
    return null;
  }
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (spans[mid].bottom <= viewTop) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  let best: number | null = null;
  let bestOverlap = 0;
  for (let i = low; i < spans.length && spans[i].top < viewBottom; i++) {
    const overlap =
      Math.min(spans[i].bottom, viewBottom) - Math.max(spans[i].top, viewTop);
    if (overlap > bestOverlap) {
      best = i;
      bestOverlap = overlap;
    }
  }
  if (best !== null) {
    return best;
  }
  if (low === spans.length) {
    return spans.length - 1;
  }
  if (low === 0) {
    return 0;
  }
  const center = (viewTop + viewBottom) / 2;
  return center - spans[low - 1].bottom <= spans[low].top - center
    ? low - 1
    : low;
}

export type PageMove = 'next' | 'prev' | 'first' | 'last';

/** The page a move lands on, or null when there is none to move to. */
export function moveTarget(
  mode: ViewMode,
  current: number,
  pageCount: number,
  spreadIndex: SpreadIndex | null,
  move: PageMove,
): number | null {
  if (pageCount === 0) {
    return null;
  }
  switch (move) {
    case 'first':
      return 0;
    case 'last':
      return pageCount - 1;
  }
  const step = move === 'next' ? 1 : -1;
  if (mode === 'spread' && spreadIndex) {
    const spread = spreadIndex.spreads[spreadIndex.spreadOf[current] + step];
    return spread ? spread[0] : null;
  }
  const target = current + step;
  return target >= 0 && target < pageCount ? target : null;
}

function compareKeys(a: PageKey, b: PageKey): number {
  return a.spineIndex - b.spineIndex || a.pageIndex - b.pageIndex;
}

/**
 * The page `target` names; null while it may still be laid out. Once it cannot
 * appear any more, the last page before it, or the first page.
 */
export function resolvePage(
  pages: readonly PageKey[],
  target: PageKey,
  complete: boolean,
): number | null {
  if (pages.length === 0) {
    return null;
  }
  let before = -1;
  let passedTargetSpine = false;
  for (let i = 0; i < pages.length; i++) {
    const order = compareKeys(pages[i], target);
    if (order === 0) {
      return i;
    }
    if (order < 0) {
      before = i;
    }
    if (pages[i].spineIndex > target.spineIndex) {
      passedTargetSpine = true;
    }
  }
  if (!complete && !passedTargetSpine) {
    return null;
  }
  return Math.max(before, 0);
}
