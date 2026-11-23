import { type CSSProperties, type ReactNode, useState } from 'react';

import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import type { ThemeScopeId } from '../../libs/theme-variables';
import { getTargetLabel } from './labels';
import { previewContent } from './margin-box-content';
import {
  ALL_MARGIN_BOXES,
  EDGE_MARGIN_BOXES,
  findCell,
  findSpreadSideBox,
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
import type { MarginBoxOption } from './rows';
import { ModifiedDot } from './settings-toc';

const PLACED = new Set([
  ...MARGIN_BOX_CELLS.map((cell) => cell.id),
  ...SHARED_MARGIN_BOXES,
  ...SPREAD_SIDE_BOXES,
]);

const EDGES = new Set(Object.values(EDGE_MARGIN_BOXES));

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
 * book comes to first bears the even number.
 */
function getPreviewPages(
  scope: ThemeScopeId,
  progression: PageProgression,
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
  return (['left', 'right'] as const).map((side) => ({
    page: { side, first: false },
    number: side === earlier ? 12 : 13,
    reached: both && scope !== (side === 'left' ? 'page-right' : 'page-left'),
  }));
}

interface Picker {
  options: ReadonlyMap<string, MarginBoxOption>;
  current: string | null;
  /**
   * Whether a box is tied to the target hovered or picked: what it falls back
   * to, or what falls back to it, on the page given for a cell.
   */
  isRelated: (id: string, page?: SpreadPage) => boolean;
  select: (id: string) => void;
  hover: (id: string | null) => void;
}

const spreadSideBoxesOf = (cell: MarginBoxCell) =>
  (['left', 'right'] as const).flatMap((page) => {
    const name = getSpreadContentFallback(cell, page);
    return name === null ? [] : (findSpreadSideBox(name) ?? []);
  });

function usePicker(
  boxes: readonly MarginBoxOption[],
  currentKey: string,
  onSelect: (section: string) => void,
): Picker {
  const options = new Map(boxes.map((box) => [box.id, box]));
  const current = boxes.find((box) => box.key === currentKey)?.id ?? null;
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = hovered ?? current;

  let isRelated: Picker['isRelated'] = () => false;
  const sideVariables = focus === null ? [] : getSpreadSideVariables(focus);
  if (sideVariables.length > 0) {
    // Which cells show the content depends on the page they are on.
    isRelated = (id, page) => {
      const cell = findCell(id);
      const name = cell && page && getSpreadContentFallback(cell, page);
      return !!name && sideVariables.includes(name);
    };
  } else if (focus !== null) {
    const cell = findCell(focus);
    const related = new Set(
      cell
        ? [...cell.fallbacks, ...spreadSideBoxesOf(cell)]
        : [
            ...getCellsSharing(focus).map((c) => c.id),
            ...(EDGES.has(focus) ? [ALL_MARGIN_BOXES] : []),
          ],
    );
    isRelated = (id) => related.has(id);
  }

  return {
    options,
    current,
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

const BAND_CLASS =
  'border-dashed text-muted-foreground [&[aria-current]]:text-primary-foreground';

/**
 * The band of an edge's shared box, followed by the sections of what its
 * boxes show on the outside and the inside of a spread.
 */
function EdgeBand({
  picker,
  edge,
  className,
}: {
  picker: Picker;
  edge: MarginBoxEdge;
  className: string;
}) {
  const vertical = edge === 'left' || edge === 'right';
  const text = vertical ? 'px-0 [writing-mode:vertical-rl]' : 'py-0.5';
  return (
    <div
      className={cn('flex min-w-0 gap-1', vertical && 'flex-col', className)}
    >
      <BoxButton
        picker={picker}
        id={EDGE_MARGIN_BOXES[edge]}
        className={cn(BAND_CLASS, 'flex-1', text)}
      />
      {(['outside', 'inside'] as const).map((side) => (
        <BoxButton
          key={side}
          picker={picker}
          id={getSpreadSideBox(edge, side)}
          className={cn(
            BAND_CLASS,
            'shrink-0',
            text,
            vertical ? 'py-2' : 'px-2',
          )}
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
  writingMode,
  getContent,
}: {
  picker: Picker;
  page: PreviewPage;
  number: number;
  reached: boolean;
  writingMode: WritingMode;
  getContent: MarginBoxContentGetter;
}) {
  return (
    <div
      className={cn(
        'grid aspect-[148/210] min-w-0 grid-cols-[1.25rem_repeat(3,minmax(0,1fr))_1.25rem] grid-rows-[1.5rem_repeat(3,minmax(0,1fr))_1.5rem] gap-0.5 border bg-background p-0.5 shadow-sm transition-opacity',
        page.side === 'left'
          ? 'col-start-1 rounded-l-md'
          : cn('col-start-2 rounded-r-md', !page.first && 'border-l-0'),
        !reached && 'opacity-40',
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
            // Both pages show the same boxes, so the keyboard visits them once.
            tabIndex={!page.first && page.side === 'right' ? -1 : undefined}
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
 * Picks the margin box whose settings the list shows, on a spread that
 * previews what each box holds. The boxes that several boxes fall back to
 * run along its edges or follow below it.
 */
export function MarginBoxPicker({
  boxes,
  current,
  onSelect,
  scope,
  writingMode,
  getContent,
}: {
  /** The boxes with settings to show; the rest are disabled. */
  boxes: readonly MarginBoxOption[];
  current: string;
  onSelect: (section: string) => void;
  /** The scope the list edits, whose pages the preview sets apart. */
  scope: ThemeScopeId;
  writingMode: WritingMode;
  getContent: MarginBoxContentGetter;
}) {
  const picker = usePicker(boxes, current, onSelect);
  const unplaced = boxes.filter((box) => !PLACED.has(box.id));
  return (
    <div className="my-3 grid max-w-md gap-3">
      <fieldset
        aria-label={m.theme_settings_margin_boxes_position_aria()}
        className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_1.25rem] gap-1"
      >
        <EdgeBand
          picker={picker}
          edge="top"
          className="col-start-2 col-end-4 row-start-1"
        />
        <EdgeBand
          picker={picker}
          edge="left"
          className="col-start-1 row-start-2"
        />
        <div className="col-start-2 col-end-4 row-start-2 grid grid-cols-2">
          {getPreviewPages(scope, getPageProgression(writingMode)).map(
            ({ page, number, reached }) => (
              <PreviewPageView
                key={page.side}
                picker={picker}
                page={page}
                number={number}
                reached={reached}
                writingMode={writingMode}
                getContent={getContent}
              />
            ),
          )}
        </div>
        <EdgeBand
          picker={picker}
          edge="right"
          className="col-start-4 row-start-2"
        />
        <EdgeBand
          picker={picker}
          edge="bottom"
          className="col-start-2 col-end-4 row-start-3"
        />
        <div className="col-start-2 col-end-4 row-start-4 flex justify-center">
          <BoxButton
            picker={picker}
            id={ALL_MARGIN_BOXES}
            label={m.theme_settings_margin_boxes_all()}
            className="rounded-full px-3"
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
    </div>
  );
}
