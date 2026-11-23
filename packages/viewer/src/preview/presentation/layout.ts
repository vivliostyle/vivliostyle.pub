import type { PageKey } from '../../core/page-key';
import type { PageProgression, ViewMode, Zoom } from '../../protocol';

// Pure geometry of the presentation layer. Lengths are in page CSS px (the
// unit core lays pages out in) unless a name says otherwise; the display scale
// turns them into screen px.

export type PageSide = 'left' | 'right';

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

export interface Extent {
  width: number;
  height: number;
}

/**
 * The scale `zoom` shows content at in an area of `available` screen px.
 * `content` is what has to fit: in scroll mode, the arrangement's width and
 * its tallest page.
 */
export function zoomScale(
  zoom: Zoom,
  content: Extent,
  available: Extent,
): number {
  if (typeof zoom === 'number') {
    return zoom;
  }
  if (content.width <= 0 || content.height <= 0) {
    return 1;
  }
  const widthScale = available.width / content.width;
  return Math.max(
    minScale,
    zoom === 'fit-width'
      ? widthScale
      : Math.min(widthScale, available.height / content.height),
  );
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

export interface ViewExtent {
  mode: ViewMode;
  progression: PageProgression;
  /** Whether no more pages will be laid out. */
  complete: boolean;
  /** Where the view starts in the page at `index` (see `offsetFor`). */
  offset: number;
  /** Height of the view in page px. */
  viewHeight: number;
  /**
   * Whether core is still to change the page at an index, e.g. to fill in a
   * reference to a page it has not laid out yet.
   */
  unsettled?: (index: number) => boolean;
}

/**
 * Whether `pages` already hold everything the view on the page at `index`
 * shows, so that more pages arriving cannot change it: the partner of a
 * verso in spread mode, the pages down to the bottom of the view in scroll
 * mode, none of them unsettled.
 */
export function coversView(
  pages: readonly PageBox[],
  index: number,
  {
    mode,
    progression,
    complete,
    offset,
    viewHeight,
    unsettled = () => false,
  }: ViewExtent,
): boolean {
  if (complete) {
    return true;
  }
  const shown = pagesInView(
    pages,
    index,
    mode,
    progression,
    offset,
    viewHeight,
  );
  return shown !== null && !shown.some(unsettled);
}

/** Null while pages the view shows may still be laid out. */
function pagesInView(
  pages: readonly PageBox[],
  index: number,
  mode: ViewMode,
  progression: PageProgression,
  offset: number,
  viewHeight: number,
): number[] | null {
  if (mode === 'single') {
    return [index];
  }
  if (mode === 'spread') {
    const verso = versoSide(progression);
    if (pages[index].side === verso) {
      if (index === pages.length - 1) {
        return null;
      }
      return pages[index + 1].side === verso ? [index] : [index, index + 1];
    }
    return index > 0 && pages[index - 1].side === verso
      ? [index - 1, index]
      : [index];
  }
  // A page that starts below the top of the view leaves the end of the one
  // before it in view.
  const shown = offset < 0 && index > 0 ? [index - 1] : [];
  let bottom = 0;
  for (let i = index; i < pages.length; i++) {
    shown.push(i);
    bottom += pages[i].height;
    if (bottom >= offset + viewHeight) {
      return shown;
    }
    bottom += scrollGap;
  }
  return null;
}

/** Index of the first of `pages`, in key order, that comes after `key`. */
export function firstPageAfter(
  pages: readonly PageKey[],
  key: PageKey,
): number {
  const index = pages.findIndex((page) => compareKeys(page, key) > 0);
  return index < 0 ? pages.length : index;
}

export interface PageLocation {
  /** The page `target` names, or the last page before it, or the first page. */
  index: number;
  /**
   * False while a page `target` names, missing from `pages`, may still be
   * laid out, e.g. after core took a run of pages away to lay them out again.
   */
  settled: boolean;
}

/**
 * Where `target` is in `pages`. A page core replaced in place keeps its key,
 * so only a page that is missing falls back to the one before it.
 */
export function locatePage(
  pages: readonly PageKey[],
  target: PageKey,
  complete: boolean,
): PageLocation | null {
  if (pages.length === 0) {
    return null;
  }
  let before = -1;
  let passedTargetSpine = false;
  for (let i = 0; i < pages.length; i++) {
    const order = compareKeys(pages[i], target);
    if (order === 0) {
      return { index: i, settled: true };
    }
    if (order < 0) {
      before = i;
    }
    if (pages[i].spineIndex > target.spineIndex) {
      passedTargetSpine = true;
    }
  }
  return {
    index: Math.max(before, 0),
    settled: complete || passedTargetSpine,
  };
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
  const location = locatePage(pages, target, complete);
  return location?.settled ? location.index : null;
}

/**
 * The page a scroll position shows most of (see `dominantSpan`). While the
 * target page is missing, a view of no page at all names none, so that the
 * target stays the position to return to.
 */
export function viewedPage(
  spans: readonly Span[],
  viewTop: number,
  viewBottom: number,
  targetShown: boolean,
): number | null {
  const index = dominantSpan(spans, viewTop, viewBottom);
  if (index === null || targetShown) {
    return index;
  }
  const span = spans[index];
  return span.bottom > viewTop && span.top < viewBottom ? index : null;
}
