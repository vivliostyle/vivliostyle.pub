import { type ComponentType, useEffect, useRef, useState } from 'react';

import type { ExtensionTranslate } from '@v/extension-kit';
import { Button } from '@v/ui/button';
import {
  SegmentedRadioGroup,
  SegmentedRadioGroupItem,
} from '@v/ui/custom/segmented-radio';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@v/ui/dropdown';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GalleryVerticalEnd,
  Loader2,
  Minus,
  MoveHorizontal,
  Plus,
  RectangleVertical,
  Scan,
  TriangleAlert,
} from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { Separator } from '@v/ui/separator';
import {
  clampZoomScale,
  isViewMode,
  type StageState,
  stepZoomScale,
  type ViewMode,
  viewModes,
  type Zoom,
  type ZoomFit,
  zoomFits,
} from '@v/viewer/protocol';
import type { PreviewPreferences } from './preferences';
import type { StageCommands } from './use-stage';

const viewModeOptions: Record<
  ViewMode,
  { icon: ComponentType; label: string }
> = {
  single: { icon: RectangleVertical, label: 'preview_view_mode_single' },
  spread: { icon: BookOpen, label: 'preview_view_mode_spread' },
  scroll: { icon: GalleryVerticalEnd, label: 'preview_view_mode_scroll' },
};

export function Toolbar({
  stage,
  state,
  preferences,
  onPreferencesChange,
  t,
}: {
  stage: StageCommands | null;
  state: StageState | null;
  preferences: PreviewPreferences;
  onPreferencesChange: (patch: Partial<PreviewPreferences>) => void;
  t: ExtensionTranslate;
}) {
  const pageCount = state?.pageCount ?? 0;
  // Pages of a right-to-left publication progress leftward, the way its
  // spreads are laid out, so the left button turns forward there.
  const rtl = state?.pageProgression === 'rtl';
  const pageButton = (move: 'prev' | 'next', Icon: ComponentType) => (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={t(
        move === 'next' ? 'preview_next_page_aria' : 'preview_prev_page_aria',
      )}
      disabled={!stage || !(move === 'next' ? state?.canNext : state?.canPrev)}
      onClick={() => (move === 'next' ? stage?.next() : stage?.prev())}
    >
      <Icon />
    </Button>
  );

  return (
    // The sides share the width equally so that paging stays centered. A pane
    // too narrow even for the compact controls scrolls them rather than
    // letting them wrap onto a second row.
    <div className="@container flex shrink-0 items-center gap-2 overflow-x-auto border-b px-2 py-1 [scrollbar-width:none]">
      {/* The host lays its sidebar toggle over the top-left corner of the
          leftmost pane, so the first control starts clear of it. */}
      <div className="flex flex-1 ps-10">
        <SegmentedRadioGroup
          aria-label={t('preview_view_mode_aria')}
          value={preferences.viewMode}
          onValueChange={(value) => {
            if (isViewMode(value)) {
              onPreferencesChange({ viewMode: value });
            }
          }}
        >
          {viewModes.map((viewMode) => {
            const { icon: Icon, label } = viewModeOptions[viewMode];
            return (
              <SegmentedRadioGroupItem
                key={viewMode}
                value={viewMode}
                aria-label={t(label)}
                title={t(label)}
              >
                <Icon />
              </SegmentedRadioGroupItem>
            );
          })}
        </SegmentedRadioGroup>
      </div>

      <div className="flex items-center gap-1">
        {pageButton(rtl ? 'next' : 'prev', ChevronLeft)}
        <PageNumberInput
          pageIndex={state?.pageIndex ?? 0}
          pageCount={pageCount}
          disabled={!stage || pageCount === 0}
          onGoTo={(pageIndex) => stage?.goTo(pageIndex)}
          t={t}
        />
        <span className="min-w-8 text-sm text-muted-foreground tabular-nums @max-md:hidden">
          / {pageCount > 0 ? pageCount : '-'}
        </span>
        {pageButton(rtl ? 'prev' : 'next', ChevronRight)}
      </div>

      <div className="flex flex-1 items-center justify-end gap-1">
        <ZoomControls
          disabled={!stage}
          zoom={preferences.zoom}
          scale={state?.scale ?? null}
          onZoom={(zoom) => onPreferencesChange({ zoom })}
          t={t}
        />
        <span
          className="grid size-4 place-items-center"
          title={state?.failed ? t('preview_update_failed') : undefined}
        >
          {state?.failed ? (
            <TriangleAlert
              role="img"
              aria-label={t('preview_update_failed')}
              className="size-4 text-destructive"
            />
          ) : (
            state &&
            state.status !== 'complete' && (
              <Loader2
                role="img"
                aria-label={t('preview_rendering_aria')}
                className="size-4 animate-spin text-muted-foreground"
              />
            )
          )}
        </span>
      </div>
    </div>
  );
}

function PageNumberInput({
  pageIndex,
  pageCount,
  disabled,
  onGoTo,
  t,
}: {
  pageIndex: number;
  pageCount: number;
  disabled: boolean;
  onGoTo: (pageIndex: number) => void;
  t: ExtensionTranslate;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) {
      return;
    }
    const pageNumber = Number.parseInt(draft, 10);
    if (Number.isFinite(pageNumber)) {
      onGoTo(pageNumber - 1);
    }
    setDraft(null);
  };

  return (
    <Input
      inputMode="numeric"
      aria-label={t('preview_page_number_aria')}
      className="h-8 w-14 px-1 text-center tabular-nums"
      disabled={disabled}
      value={draft ?? (pageCount > 0 ? `${pageIndex + 1}` : '')}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        } else if (event.key === 'Escape') {
          setDraft(null);
        }
      }}
    />
  );
}

const zoomFitOptions: Record<ZoomFit, { icon: ComponentType; label: string }> =
  {
    'fit-width': { icon: MoveHorizontal, label: 'preview_zoom_fit_width' },
    'fit-page': { icon: Scan, label: 'preview_zoom_fit_page' },
  };

type ZoomDirection = 'in' | 'out';

const zoomStepOptions: Record<
  ZoomDirection,
  { icon: ComponentType; label: string }
> = {
  in: { icon: Plus, label: 'preview_zoom_in_aria' },
  out: { icon: Minus, label: 'preview_zoom_out_aria' },
};

function ZoomControls({
  disabled,
  zoom,
  scale,
  onZoom,
  t,
}: {
  disabled: boolean;
  zoom: Zoom;
  /** The scale the stage shows the pages at; null until it reports one. */
  scale: number | null;
  onZoom: (zoom: Zoom) => void;
  t: ExtensionTranslate;
}) {
  // A fixed zoom is what the stage is about to show, and may be ahead of what
  // it last reported after quick clicks.
  const current = typeof zoom === 'number' ? zoom : scale;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = menuTriggerRef.current;
    if (!menuOpen || !trigger) {
      return;
    }
    // Once the toolbar widens enough for the full controls, the trigger
    // leaves the layout and the open menu would lose its anchor.
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === 0) {
        setMenuOpen(false);
      }
    });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [menuOpen]);
  const nextScale = (direction: ZoomDirection) =>
    current === null ? null : stepZoomScale(current, direction);
  const stepButton = (direction: ZoomDirection) => {
    const { icon: Icon, label } = zoomStepOptions[direction];
    const next = nextScale(direction);
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={t(label)}
        title={t(label)}
        disabled={disabled || next === null}
        onClick={() => next !== null && onZoom(next)}
      >
        <Icon />
      </Button>
    );
  };

  return (
    <>
      <div className="flex items-center gap-1 @max-xl:hidden">
        {stepButton('out')}
        <ZoomInput scale={current} disabled={disabled} onZoom={onZoom} t={t} />
        {stepButton('in')}
        <Separator orientation="vertical" className="mx-1 h-5" />
        {zoomFits.map((fit) => {
          const { icon: Icon, label } = zoomFitOptions[fit];
          const pressed = zoom === fit;
          return (
            <Button
              key={fit}
              variant={pressed ? 'default' : 'ghost'}
              size="icon"
              className="size-8"
              aria-label={t(label)}
              aria-pressed={pressed}
              title={t(label)}
              disabled={disabled}
              onClick={() => onZoom(fit)}
            >
              <Icon />
            </Button>
          );
        })}
      </div>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuTriggerRef}
            variant="ghost"
            className="h-8 gap-1 px-2 tabular-nums @xl:hidden"
            aria-label={t('preview_zoom_level_aria')}
            disabled={disabled}
          >
            {current === null ? '-' : `${Math.round(current * 100)}%`}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(['in', 'out'] as const).map((direction) => {
            const { icon: Icon, label } = zoomStepOptions[direction];
            const next = nextScale(direction);
            return (
              <DropdownMenuItem
                key={direction}
                disabled={next === null}
                onSelect={(event) => {
                  // Left open so that a few steps take a click each.
                  event.preventDefault();
                  if (next !== null) {
                    onZoom(next);
                  }
                }}
              >
                <Icon />
                {t(label)}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          {zoomFits.map((fit) => (
            <DropdownMenuCheckboxItem
              key={fit}
              checked={zoom === fit}
              onCheckedChange={() => onZoom(fit)}
            >
              {t(zoomFitOptions[fit].label)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ZoomInput({
  scale,
  disabled,
  onZoom,
  t,
}: {
  scale: number | null;
  disabled: boolean;
  onZoom: (zoom: Zoom) => void;
  t: ExtensionTranslate;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) {
      return;
    }
    const percent = Number.parseFloat(draft);
    if (Number.isFinite(percent) && percent > 0) {
      onZoom(clampZoomScale(percent / 100));
    }
    setDraft(null);
  };

  return (
    <Input
      inputMode="decimal"
      aria-label={t('preview_zoom_level_aria')}
      className="h-8 w-16 px-1 text-center tabular-nums"
      disabled={disabled}
      value={draft ?? (scale === null ? '' : `${Math.round(scale * 100)}%`)}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        } else if (event.key === 'Escape') {
          setDraft(null);
        }
      }}
    />
  );
}
