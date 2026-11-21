export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

/** The part of an element this module reads; `Element` satisfies it. */
export interface ScrollBox {
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
  readonly parentElement: ScrollBox | null;
}

export interface ScrollStyle {
  overflowX: string;
  overflowY: string;
  writingMode: string;
  direction: string;
}

const userScrollable = new Set(['auto', 'scroll', 'overlay']);

// Where the scroll position is 0 depends on the writing mode and direction;
// from there it runs negative toward the other edge.
function rightOrigin({ writingMode, direction }: ScrollStyle): boolean {
  return writingMode === 'horizontal-tb'
    ? direction === 'rtl'
    : writingMode === 'vertical-rl' || writingMode === 'sideways-rl';
}

function bottomOrigin({ writingMode, direction }: ScrollStyle): boolean {
  return writingMode !== 'horizontal-tb' && direction === 'rtl';
}

function scrollsToward(
  box: ScrollBox,
  direction: ScrollDirection,
  styleOf: (box: ScrollBox) => ScrollStyle,
): boolean {
  const vertical = direction === 'up' || direction === 'down';
  const range = vertical
    ? box.scrollHeight - box.clientHeight
    : box.scrollWidth - box.clientWidth;
  if (range <= 1) {
    return false;
  }
  const style = styleOf(box);
  if (!userScrollable.has(vertical ? style.overflowY : style.overflowX)) {
    return false;
  }
  const negative = vertical ? bottomOrigin(style) : rightOrigin(style);
  const position = vertical ? box.scrollTop : box.scrollLeft;
  const [min, max] = negative ? [-range, 0] : [0, range];
  return direction === 'down' || direction === 'right'
    ? position < max - 1
    : position > min + 1;
}

/**
 * Whether a wheel or arrow key aimed at `target` would scroll something on its
 * way up to `viewport`, the outermost scroll container considered; a target
 * outside `viewport` stands for the viewport itself.
 */
export function canScrollToward(
  target: ScrollBox | null,
  viewport: ScrollBox,
  direction: ScrollDirection,
  styleOf: (box: ScrollBox) => ScrollStyle,
): boolean {
  for (let box = target; box; box = box.parentElement) {
    if (scrollsToward(box, direction, styleOf)) {
      return true;
    }
    if (box === viewport) {
      return false;
    }
  }
  return scrollsToward(viewport, direction, styleOf);
}
