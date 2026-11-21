import type { CSSProperties } from 'react';

import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import { getTargetLabel } from './labels';
import {
  MARGIN_BOX_CELLS,
  MARGIN_BOX_GROUP,
  SHARED_MARGIN_BOXES,
} from './margin-boxes';
import type { MarginBoxOption } from './rows';
import { ModifiedDot } from './settings-toc';

const PLACED = new Set([
  ...MARGIN_BOX_CELLS.map((cell) => cell.id),
  ...SHARED_MARGIN_BOXES,
]);

/** Picks the margin box whose settings the list shows, on a page diagram. */
export function MarginBoxPicker({
  boxes,
  current,
  onSelect,
}: {
  /** The boxes with settings to show; the rest are disabled. */
  boxes: readonly MarginBoxOption[];
  current: string;
  onSelect: (section: string) => void;
}) {
  const options = new Map(boxes.map((box) => [box.id, box]));
  // A box that a newer theme-base adds still gets a button.
  const shared = [
    ...SHARED_MARGIN_BOXES,
    ...boxes.map((box) => box.id).filter((id) => !PLACED.has(id)),
  ];

  const renderBox = (id: string, style?: CSSProperties) => {
    const option = options.get(id);
    const selected = option?.key === current;
    return (
      <button
        key={id}
        type="button"
        style={style}
        disabled={!option}
        aria-current={selected || undefined}
        className={cn(
          'relative flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-2 py-1 text-center text-xs leading-tight hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent',
          selected &&
            'border-primary bg-primary text-primary-foreground hover:bg-primary',
        )}
        onClick={() => option && onSelect(option.key)}
      >
        {getTargetLabel(MARGIN_BOX_GROUP, id)}
        {option && (
          <span className="absolute top-1 right-1 flex">
            <ModifiedDot count={option.modified} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="my-3 grid gap-3">
      <fieldset
        aria-label={m.theme_settings_margin_boxes_position_aria()}
        className="grid min-w-0 grid-cols-5 gap-1"
      >
        {MARGIN_BOX_CELLS.map(({ id, row, column }) =>
          renderBox(id, { gridRow: row, gridColumn: column }),
        )}
        <div
          aria-hidden
          className="col-start-2 col-end-5 row-start-2 row-end-5 grid place-items-center rounded-md border border-dashed text-xs text-muted-foreground"
        >
          {m.theme_settings_margin_boxes_page_area()}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-1 text-xs text-muted-foreground">
          {m.theme_settings_margin_boxes_shared()}
        </legend>
        <div className="flex flex-wrap gap-1">
          {shared.map((id) => renderBox(id))}
        </div>
      </fieldset>
    </div>
  );
}
