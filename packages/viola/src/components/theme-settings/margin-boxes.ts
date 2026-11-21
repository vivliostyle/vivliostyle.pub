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

/** Cells of a 5×5 grid that place the boxes as they sit around a page. */
export const MARGIN_BOX_CELLS: readonly {
  id: string;
  row: number;
  column: number;
}[] = [
  { id: 'mbox-top-left-corner', row: 1, column: 1 },
  { id: 'mbox-top-left', row: 1, column: 2 },
  { id: 'mbox-top-center', row: 1, column: 3 },
  { id: 'mbox-top-right', row: 1, column: 4 },
  { id: 'mbox-top-right-corner', row: 1, column: 5 },
  { id: 'mbox-left-top', row: 2, column: 1 },
  { id: 'mbox-right-top', row: 2, column: 5 },
  { id: 'mbox-left-middle', row: 3, column: 1 },
  { id: 'mbox-right-middle', row: 3, column: 5 },
  { id: 'mbox-left-bottom', row: 4, column: 1 },
  { id: 'mbox-right-bottom', row: 4, column: 5 },
  { id: 'mbox-bottom-left-corner', row: 5, column: 1 },
  { id: 'mbox-bottom-left', row: 5, column: 2 },
  { id: 'mbox-bottom-center', row: 5, column: 3 },
  { id: 'mbox-bottom-right', row: 5, column: 4 },
  { id: 'mbox-bottom-right-corner', row: 5, column: 5 },
];

/** Boxes that several cells fall back to, which no single cell shows. */
export const SHARED_MARGIN_BOXES = [
  ALL_MARGIN_BOXES,
  'mbox-top',
  'mbox-right',
  'mbox-bottom',
  'mbox-left',
  'mbox-top-inner',
  'mbox-right-inner',
  'mbox-bottom-inner',
  'mbox-left-inner',
];
