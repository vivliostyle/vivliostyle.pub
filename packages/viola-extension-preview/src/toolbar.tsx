import { type ComponentType, useState } from 'react';

import type { ExtensionTranslate } from '@v/extension-kit';
import { Button } from '@v/ui/button';
import {
  SegmentedRadioGroup,
  SegmentedRadioGroupItem,
} from '@v/ui/custom/segmented-radio';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  GalleryVerticalEnd,
  Loader2,
  RectangleVertical,
  TriangleAlert,
} from '@v/ui/icon';
import { Input } from '@v/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@v/ui/select';
import {
  isPaperSize,
  isViewMode,
  type PaperSize,
  paperSizes,
  type StageState,
  type ViewMode,
  viewModes,
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

const paperSizeLabels: Record<PaperSize, string> = {
  a4: 'preview_paper_size_a4',
  a5: 'preview_paper_size_a5',
  a6: 'preview_paper_size_a6',
  'jis-b5': 'preview_paper_size_jis_b5',
  'jis-b6': 'preview_paper_size_jis_b6',
  letter: 'preview_paper_size_letter',
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
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-2 py-1">
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

      <div className="flex items-center gap-1">
        {pageButton(rtl ? 'next' : 'prev', ChevronLeft)}
        <PageNumberInput
          pageIndex={state?.pageIndex ?? 0}
          pageCount={pageCount}
          disabled={!stage || pageCount === 0}
          onGoTo={(pageIndex) => stage?.goTo(pageIndex)}
          t={t}
        />
        <span className="min-w-8 text-sm text-muted-foreground tabular-nums">
          / {pageCount > 0 ? pageCount : '-'}
        </span>
        {pageButton(rtl ? 'prev' : 'next', ChevronRight)}
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={preferences.paperSize}
          onValueChange={(value) => {
            if (isPaperSize(value)) {
              onPreferencesChange({ paperSize: value });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={t('preview_paper_size_aria')}
            title={t('preview_paper_size_hint')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {paperSizes.map((paperSize) => (
              <SelectItem key={paperSize} value={paperSize}>
                {t(paperSizeLabels[paperSize])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
