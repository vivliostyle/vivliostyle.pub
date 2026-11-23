import type { ThemeVariableSubgroup } from '../../libs/theme-variables';

export const MARGIN_BOX_GROUP = 'page';

/** The box whose settings every margin box falls back to. */
export const ALL_MARGIN_BOXES = 'mbox';

/** The margin box a subgroup sets, or `null` for any other subgroup. */
export function getMarginBox(
  subgroup: Pick<ThemeVariableSubgroup, 'group' | 'kind' | 'id'>,
): string | null {
  return subgroup.group === MARGIN_BOX_GROUP &&
    subgroup.kind === 'target' &&
    (subgroup.id === ALL_MARGIN_BOXES ||
      subgroup.id.startsWith(`${ALL_MARGIN_BOXES}-`))
    ? subgroup.id
    : null;
}

export type MarginBoxEdge = 'top' | 'right' | 'bottom' | 'left';

export type SpreadPage = 'left' | 'right';

export type SpreadSide = 'outside' | 'inside';

/** A page the preview draws: either page of a spread, or the first alone. */
export type PreviewPage = SpreadPage | 'first';

/** The page classes that a preview page matches. */
export const PREVIEW_PAGE_CLASSES: Readonly<
  Record<PreviewPage, readonly string[]>
> = {
  left: ['left'],
  right: ['right'],
  // A book opens on a right page.
  first: ['first', 'right'],
};

export const sideOfPage = (page: PreviewPage): SpreadPage =>
  page === 'first' ? 'right' : page;

export type MarginBoxPosition =
  | 'corner'
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom';

export interface MarginBoxCell {
  id: string;
  /** Row and column of a 5×5 grid that places the boxes around a page. */
  row: number;
  column: number;
  /** The edge the box sits on; a corner counts as part of the top or bottom. */
  edge: MarginBoxEdge;
  position: MarginBoxPosition;
  /** The physical side of the page the box leans to, if any. */
  side: 'left' | 'right' | null;
  /** The shared boxes the box falls back to, nearest first. */
  fallbacks: readonly string[];
}

function corner(
  edge: 'top' | 'bottom',
  side: 'left' | 'right',
  row: number,
  column: number,
): MarginBoxCell {
  return {
    id: `mbox-${edge}-${side}-corner`,
    row,
    column,
    edge,
    position: 'corner',
    side,
    fallbacks: [`mbox-${edge}`, `mbox-${side}`, ALL_MARGIN_BOXES],
  };
}

// A box at either end of an edge takes its spacing toward the corner from the
// `-inner` box of that end, such as `mbox-left-inner` for `mbox-top-left`.
function along(
  edge: MarginBoxEdge,
  position: Exclude<MarginBoxPosition, 'corner'>,
  row: number,
  column: number,
): MarginBoxCell {
  const end = position === 'center' || position === 'middle' ? null : position;
  return {
    id: `mbox-${edge}-${position}`,
    row,
    column,
    edge,
    position,
    side:
      edge === 'left' || edge === 'right'
        ? edge
        : position === 'left' || position === 'right'
          ? position
          : null,
    fallbacks: [
      `mbox-${edge}`,
      ...(end ? [`mbox-${end}-inner`] : []),
      ALL_MARGIN_BOXES,
    ],
  };
}

export const MARGIN_BOX_CELLS: readonly MarginBoxCell[] = [
  corner('top', 'left', 1, 1),
  along('top', 'left', 1, 2),
  along('top', 'center', 1, 3),
  along('top', 'right', 1, 4),
  corner('top', 'right', 1, 5),
  along('left', 'top', 2, 1),
  along('right', 'top', 2, 5),
  along('left', 'middle', 3, 1),
  along('right', 'middle', 3, 5),
  along('left', 'bottom', 4, 1),
  along('right', 'bottom', 4, 5),
  corner('bottom', 'left', 5, 1),
  along('bottom', 'left', 5, 2),
  along('bottom', 'center', 5, 3),
  along('bottom', 'right', 5, 4),
  corner('bottom', 'right', 5, 5),
];

export const EDGE_MARGIN_BOXES: Readonly<Record<MarginBoxEdge, string>> = {
  top: 'mbox-top',
  right: 'mbox-right',
  bottom: 'mbox-bottom',
  left: 'mbox-left',
};

/** Boxes that set only the spacing toward the corners at an end of an edge. */
export const INNER_MARGIN_BOXES = [
  'mbox-top-inner',
  'mbox-bottom-inner',
  'mbox-left-inner',
  'mbox-right-inner',
];

/** Boxes that several cells fall back to, which no single cell shows. */
export const SHARED_MARGIN_BOXES = [
  ALL_MARGIN_BOXES,
  ...Object.values(EDGE_MARGIN_BOXES),
  ...INNER_MARGIN_BOXES,
];

/** The cells that fall back to a shared box. */
export function getCellsSharing(id: string): MarginBoxCell[] {
  return MARGIN_BOX_CELLS.filter((cell) => cell.fallbacks.includes(id));
}

export function findCell(id: string): MarginBoxCell | undefined {
  return MARGIN_BOX_CELLS.find((cell) => cell.id === id);
}

/**
 * Name of the variable a cell's `content` falls back to on a page of a
 * spread, which theme-base words by the inside or outside of the spread.
 */
export function getSpreadContentFallback(
  cell: MarginBoxCell,
  page: SpreadPage,
): string | null {
  if (cell.side === null) {
    return null;
  }
  const side = cell.side === page ? 'outside' : 'inside';
  if (cell.position === 'corner') {
    return `--vs-page--mbox-${cell.edge}-${side}-corner-content`;
  }
  if (cell.edge === 'top' || cell.edge === 'bottom') {
    return `--vs-page--mbox-${cell.edge}-${side}-content`;
  }
  return `--vs-page--mbox-${side}-${cell.position}-content`;
}

const SPREAD_PAGES: readonly SpreadPage[] = ['left', 'right'];

/**
 * The section that holds the content the boxes of an edge show on one side of
 * a spread. theme-base sets it on a shared box, the side edges on the one
 * every box falls back to, but it reads as a setting of neither.
 */
export function getSpreadSideBox(
  edge: MarginBoxEdge,
  side: SpreadSide,
): string {
  return edge === 'top' || edge === 'bottom'
    ? `mbox-${edge}-${side}`
    : `mbox-${side}`;
}

const spreadSideBoxOf = new Map<string, string>();
const spreadSideVariables = new Map<string, string[]>();
for (const cell of MARGIN_BOX_CELLS) {
  for (const page of SPREAD_PAGES) {
    const name = getSpreadContentFallback(cell, page);
    if (name === null || spreadSideBoxOf.has(name)) {
      continue;
    }
    const box = getSpreadSideBox(
      cell.edge,
      cell.side === page ? 'outside' : 'inside',
    );
    spreadSideBoxOf.set(name, box);
    spreadSideVariables.set(box, [
      ...(spreadSideVariables.get(box) ?? []),
      name,
    ]);
  }
}

export const SPREAD_SIDE_BOXES: readonly string[] = [
  ...spreadSideVariables.keys(),
];

/** The section of the content a variable gives one side of a spread, if so. */
export function findSpreadSideBox(name: string): string | null {
  return spreadSideBoxOf.get(name) ?? null;
}

export function getSpreadSideVariables(box: string): readonly string[] {
  return spreadSideVariables.get(box) ?? [];
}
