import { type CSSProperties, type ReactNode, useState } from 'react';

import { Button } from '@v/ui/button';
import { ChevronRight, Lightbulb } from '@v/ui/icon';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import type { ThemeScopeId } from '../../libs/theme-variables';
import { getTargetLabel } from './labels';
import { previewContent } from './margin-box-content';
import {
  ALL_MARGIN_BOXES,
  EDGE_MARGIN_BOXES,
  findCell,
  getCellsSharing,
  getFirstPageSide,
  getPageProgression,
  getSpreadContentFallback,
  getSpreadSideBox,
  getSpreadSideVariables,
  INNER_MARGIN_BOXES,
  MARGIN_BOX_CELLS,
  MARGIN_BOX_GROUP,
  type MarginBoxCell,
  type MarginBoxEdge,
  type PageProgression,
  type PreviewPage,
  SHARED_MARGIN_BOXES,
  SPREAD_SIDE_BOXES,
  type SpreadPage,
  type SpreadSide,
  type WritingMode,
} from './margin-boxes';
import { getScopeLabel } from './messages';
import type { MarginBoxOption } from './rows';
import { ModifiedDot } from './settings-toc';

const PLACED = new Set([
  ...MARGIN_BOX_CELLS.map((cell) => cell.id),
  ...SHARED_MARGIN_BOXES,
  ...SPREAD_SIDE_BOXES,
]);

const SPREAD_SIDES: ReadonlySet<string> = new Set(SPREAD_SIDE_BOXES);

const SAMPLE_PAGE_COUNT = 200;

// The lines of text start from the side the writing mode starts a page on.
const TEXT_LINES: Readonly<Record<WritingMode, string>> = {
  'horizontal-tb':
    'bg-[repeating-linear-gradient(to_bottom,var(--color-muted)_0_2px,transparent_2px_6px)]',
  'vertical-rl':
    'bg-[repeating-linear-gradient(to_left,var(--color-muted)_0_2px,transparent_2px_6px)]',
  'vertical-lr':
    'bg-[repeating-linear-gradient(to_right,var(--color-muted)_0_2px,transparent_2px_6px)]',
};

const SPREAD_SIDE_LABELS: Readonly<Record<SpreadSide, () => string>> = {
  outside: m.theme_settings_margin_boxes_outside,
  inside: m.theme_settings_margin_boxes_inside,
};

const boxLabel = (id: string) => getTargetLabel(MARGIN_BOX_GROUP, id);

export type MarginBoxContentGetter = (
  cell: MarginBoxCell,
  page: PreviewPage,
) => string | undefined;

/**
 * The pages the preview draws for the scope the list edits, with a sample
 * number each, and whether that scope reaches them. Of a spread, the page a
 * book comes to first bears the even number. A single page is the side the
 * scope picks, or else the side a book opens on.
 */
function getPreviewPages(
  scope: ThemeScopeId,
  progression: PageProgression,
  spread: boolean,
): { page: PreviewPage; number: number; reached: boolean }[] {
  if (scope === 'page-first') {
    return [
      {
        page: { side: getFirstPageSide(progression), first: true },
        number: 1,
        reached: true,
      },
    ];
  }
  // Rules for the screen never reach a page.
  const both = scope !== 'screen-root';
  const earlier: SpreadPage = progression === 'rtl' ? 'right' : 'left';
  const pages = (['left', 'right'] as const).map((side) => ({
    page: { side, first: false },
    number: side === earlier ? 12 : 13,
    reached: both && scope !== (side === 'left' ? 'page-right' : 'page-left'),
  }));
  if (spread) {
    return pages;
  }
  const side =
    scope === 'page-left'
      ? 'left'
      : scope === 'page-right'
        ? 'right'
        : getFirstPageSide(progression);
  return pages.filter(({ page }) => page.side === side);
}

interface Picker {
  options: ReadonlyMap<string, MarginBoxOption>;
  current: string | null;
  hovered: string | null;
  /**
   * Whether a cell, on the page given, takes what the shared box hovered or
   * picked sets.
   */
  isRelated: (id: string, page?: SpreadPage) => boolean;
  select: (id: string) => void;
  hover: (id: string | null) => void;
}

function usePicker(
  boxes: readonly MarginBoxOption[],
  currentKey: string,
  onSelect: (section: string) => void,
): Picker {
  const options = new Map(boxes.map((box) => [box.id, box]));
  const current = boxes.find((box) => box.key === currentKey)?.id ?? null;
  const [hovered, setHovered] = useState<string | null>(null);
  // Passing over a cell keeps the cells of the picked shared box marked.
  const focus =
    (hovered !== null && !findCell(hovered) ? hovered : null) ?? current;

  let isRelated: Picker['isRelated'] = () => false;
  const sideVariables = focus === null ? [] : getSpreadSideVariables(focus);
  if (sideVariables.length > 0) {
    // Which cells show the content depends on the page they are on.
    isRelated = (id, page) => {
      const cell = findCell(id);
      const name = cell && page && getSpreadContentFallback(cell, page);
      return !!name && sideVariables.includes(name);
    };
  } else if (focus !== null && !findCell(focus)) {
    const related = new Set(getCellsSharing(focus).map((c) => c.id));
    isRelated = (id) => related.has(id);
  }

  return {
    options,
    current,
    hovered,
    isRelated,
    select: (id) => {
      const option = options.get(id);
      if (option) {
        onSelect(option.key);
      }
    },
    hover: setHovered,
  };
}

function BoxButton({
  picker,
  id,
  page,
  children,
  label = boxLabel(id),
  className,
  style,
  tabIndex,
}: {
  picker: Picker;
  id: string;
  /** The page of the spread a cell is drawn on. */
  page?: SpreadPage;
  children?: ReactNode;
  label?: string;
  className?: string;
  style?: CSSProperties;
  tabIndex?: number;
}) {
  const option = picker.options.get(id);
  const selected = picker.current === id;
  return (
    <button
      type="button"
      style={style}
      tabIndex={tabIndex}
      disabled={!option}
      aria-current={selected || undefined}
      aria-label={children === undefined ? undefined : label}
      title={label}
      className={cn(
        'relative flex min-w-0 cursor-pointer items-center justify-center rounded-md border px-1.5 py-1 text-center text-xs leading-tight hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent',
        picker.isRelated(id, page) && 'border-primary/50 bg-primary/10',
        // A box drawn twice, as a cell on both pages, is one setting.
        option && picker.hovered === id && 'bg-accent',
        selected &&
          'border-primary bg-primary text-primary-foreground hover:bg-primary',
        className,
      )}
      onClick={() => picker.select(id)}
      onPointerEnter={() => picker.hover(id)}
      onPointerLeave={() => picker.hover(null)}
      onFocus={() => picker.hover(id)}
      onBlur={() => picker.hover(null)}
    >
      {children ?? label}
      {option && (
        <span className="absolute top-0.5 right-0.5 flex">
          <ModifiedDot count={option.modified} />
        </span>
      )}
    </button>
  );
}

/**
 * The band of an edge's shared box, followed on a spread by the sections of
 * what its boxes show on the outside and the inside.
 */
function EdgeBand({
  picker,
  edge,
  spread,
  className,
}: {
  picker: Picker;
  edge: MarginBoxEdge;
  spread: boolean;
  className: string;
}) {
  const vertical = edge === 'left' || edge === 'right';
  // `px` and `py` follow the writing mode, so `py` pads across vertical lines,
  // for which the side bands are too narrow.
  const text = vertical && 'py-0 [writing-mode:vertical-rl]';
  return (
    <div
      className={cn('flex min-w-0 gap-1', vertical && 'flex-col', className)}
    >
      <BoxButton
        picker={picker}
        id={EDGE_MARGIN_BOXES[edge]}
        className={cn('flex-1', text)}
      />
      {spread &&
        (['outside', 'inside'] as const).map((side) => (
          <BoxButton
            key={side}
            picker={picker}
            id={getSpreadSideBox(edge, side)}
            className={cn('shrink-0 px-2', text)}
          >
            {SPREAD_SIDE_LABELS[side]()}
          </BoxButton>
        ))}
    </div>
  );
}

function PreviewPageView({
  picker,
  page,
  number,
  reached,
  focusable,
  writingMode,
  getContent,
  className,
}: {
  picker: Picker;
  page: PreviewPage;
  number: number;
  reached: boolean;
  focusable: boolean;
  writingMode: WritingMode;
  getContent: MarginBoxContentGetter;
  className: string;
}) {
  return (
    <div
      inert={!reached}
      className={cn(
        'grid aspect-[148/210] min-w-0 grid-cols-[1.25rem_repeat(3,minmax(0,1fr))_1.25rem] grid-rows-[1.5rem_repeat(3,minmax(0,1fr))_1.5rem] gap-0.5 border bg-background p-0.5 shadow-sm transition-opacity',
        !reached && 'opacity-40',
        className,
      )}
    >
      {MARGIN_BOX_CELLS.map((cell) => {
        const text = previewContent(getContent(cell, page), {
          page: number,
          pages: SAMPLE_PAGE_COUNT,
        });
        return (
          <BoxButton
            key={cell.id}
            picker={picker}
            id={cell.id}
            page={page.side}
            style={{ gridRow: cell.row, gridColumn: cell.column }}
            tabIndex={focusable ? undefined : -1}
            className={cn(
              'rounded-sm p-0 text-[0.625rem]',
              text === null &&
                picker.current !== cell.id &&
                'border-dashed border-border/70',
            )}
          >
            <span
              className={cn(
                'truncate',
                (cell.edge === 'left' || cell.edge === 'right') &&
                  '[writing-mode:vertical-rl]',
              )}
            >
              {text ?? ''}
            </span>
          </BoxButton>
        );
      })}
      <div
        aria-hidden
        className={cn(
          'col-start-2 col-end-5 row-start-2 row-end-5 m-1',
          TEXT_LINES[writingMode],
        )}
      />
    </div>
  );
}

/**
 * Picks the margin box whose settings the list shows, on a page that previews
 * what each box holds, or on a spread with the boxes of its two sides. The
 * boxes that several boxes fall back to run along its edges or follow below
 * it.
 */
export function MarginBoxPicker({
  boxes,
  current,
  onSelect,
  scope,
  writingMode,
  getContent,
  spread,
  onSpreadChange,
}: {
  /** The boxes with settings to show; the rest are disabled. */
  boxes: readonly MarginBoxOption[];
  current: string;
  onSelect: (section: string) => void;
  /** The scope the list edits, whose pages the preview sets apart. */
  scope: ThemeScopeId;
  writingMode: WritingMode;
  getContent: MarginBoxContentGetter;
  spread: boolean;
  onSpreadChange: (spread: boolean) => void;
}) {
  const picker = usePicker(boxes, current, onSelect);
  const unplaced = boxes.filter((box) => !PLACED.has(box.id));
  // A filter may open the margin boxes on a box of a side of a spread.
  const onSide = picker.current !== null && SPREAD_SIDES.has(picker.current);
  const shown = spread || onSide;
  const pages = getPreviewPages(scope, getPageProgression(writingMode), shown);
  const toggleSpread = () => {
    if (shown && onSide) {
      picker.select(ALL_MARGIN_BOXES);
    }
    onSpreadChange(!shown);
  };
  return (
    <div className="my-3 grid max-w-md gap-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={shown}
        className="-ml-2 justify-self-start px-2"
        onClick={toggleSpread}
      >
        <ChevronRight
          aria-hidden
          className={cn('transition-transform', shown && 'rotate-90')}
        />
        {m.theme_settings_margin_boxes_spread()}
      </Button>
      <fieldset
        aria-label={m.theme_settings_margin_boxes_position_aria()}
        className={cn(
          'grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_1.25rem] gap-1',
          // As wide as a page of the spread
          !shown && 'w-full max-w-62 justify-self-center',
        )}
      >
        <EdgeBand
          picker={picker}
          edge="top"
          spread={shown}
          className="col-start-2 col-end-4 row-start-1"
        />
        <EdgeBand
          picker={picker}
          edge="left"
          spread={shown}
          className="col-start-1 row-start-2"
        />
        <div
          className={cn(
            'col-start-2 col-end-4 row-start-2 grid',
            shown && 'grid-cols-2',
          )}
        >
          {pages.map(({ page, number, reached }, index) => (
            <PreviewPageView
              key={page.side}
              picker={picker}
              page={page}
              number={number}
              reached={reached}
              // Both pages show the same boxes, so the keyboard visits them once.
              focusable={index === pages.findIndex((p) => p.reached)}
              writingMode={writingMode}
              getContent={getContent}
              className={
                !shown
                  ? 'rounded-md'
                  : page.side === 'left'
                    ? 'col-start-1 rounded-l-md'
                    : cn('col-start-2 rounded-r-md', index > 0 && 'border-l-0')
              }
            />
          ))}
        </div>
        <EdgeBand
          picker={picker}
          edge="right"
          spread={shown}
          className="col-start-4 row-start-2"
        />
        <EdgeBand
          picker={picker}
          edge="bottom"
          spread={shown}
          className="col-start-2 col-end-4 row-start-3"
        />
        <div className="col-start-2 col-end-4 row-start-4 flex justify-center">
          <BoxButton
            picker={picker}
            id={ALL_MARGIN_BOXES}
            label={m.theme_settings_margin_boxes_all()}
          />
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-1 text-xs text-muted-foreground">
          {m.theme_settings_margin_boxes_edge_ends()}
        </legend>
        <div className="flex flex-wrap gap-1">
          {INNER_MARGIN_BOXES.map((id) => (
            <BoxButton key={id} picker={picker} id={id} />
          ))}
        </div>
      </fieldset>
      {unplaced.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unplaced.map(({ id }) => (
            <BoxButton key={id} picker={picker} id={id} />
          ))}
        </div>
      )}
      {shown && scope !== 'page-left' && scope !== 'page-right' && (
        <div className="flex items-start gap-2 rounded-md border p-3 text-xs">
          <Lightbulb
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <div className="grid gap-1">
            <p className="font-medium">
              {m.theme_settings_margin_boxes_one_side_title()}
            </p>
            <p className="text-muted-foreground">
              {m.theme_settings_margin_boxes_one_side_hint({
                scope: m.theme_settings_scope_label(),
                left: getScopeLabel('page-left'),
                right: getScopeLabel('page-right'),
              })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
