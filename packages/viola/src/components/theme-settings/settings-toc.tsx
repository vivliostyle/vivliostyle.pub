import { Fragment, memo, useId, useMemo } from 'react';

import { ChevronRight } from '@v/ui/icon';
import { Label } from '@v/ui/label';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import type { PrerenderTriggerProps } from '../../hooks/use-prerender';
import { NativeSelect } from './native-select';
import { getTocKey, type SettingsSection, type SettingsTocGroup } from './rows';

export interface SettingsTocProps {
  toc: readonly SettingsTocGroup[];
  /** `null` while every match shows, which only a filter allows. */
  section: string | null;
  filtering: boolean;
  matchCount: number;
  onSelect: (section: string | null) => void;
  /** Handlers that prerender the list of a section a pick may be coming to. */
  getPrerenderProps: (section: string | null) => PrerenderTriggerProps;
}

const showsSection = (entry: SettingsSection, section: string | null) =>
  entry.key === section || !!entry.members?.some((m) => m.key === section);

const holdsSection = (group: SettingsTocGroup, section: string | null) =>
  group.key === section ||
  group.subgroups.some((subgroup) => showsSection(subgroup, section));

export function ModifiedDot({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }
  const label = m.theme_settings_group_modified_count({ count });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="size-1.5 shrink-0 rounded-full bg-primary"
    />
  );
}

type TocButtonKind = 'all' | 'group' | 'subgroup';

// Memoized with stable props, so that a pick re-renders only the buttons whose
// state it changes.
const TocButton = memo(function TocButton({
  kind,
  sectionKey,
  label,
  count,
  modified,
  current,
  open = false,
  expandable = false,
  showCount,
  onSelect,
  getPrerenderProps,
}: {
  kind: TocButtonKind;
  sectionKey: string | null;
  label: string;
  count: number;
  modified: number;
  current: boolean;
  open?: boolean;
  expandable?: boolean;
  showCount: boolean;
  onSelect: (section: string | null) => void;
  getPrerenderProps: (section: string | null) => PrerenderTriggerProps;
}) {
  return (
    <button
      type="button"
      aria-current={current || undefined}
      className={cn(
        'flex w-full cursor-pointer items-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        kind === 'all' && 'pl-6',
        kind === 'group' && open && 'font-medium',
        kind === 'subgroup' && 'pl-6 text-xs',
        current && 'bg-accent font-medium text-accent-foreground',
      )}
      onClick={() => onSelect(sectionKey)}
      {...getPrerenderProps(sectionKey)}
    >
      {kind === 'group' && (
        <span className="flex h-lh shrink-0 items-center">
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
              !expandable && 'invisible',
            )}
          />
        </span>
      )}
      <span className="min-w-0 flex-1 wrap-break-word">{label}</span>
      <span className="flex h-lh shrink-0 items-center gap-1.5">
        <ModifiedDot count={modified} />
        {showCount && (
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </span>
    </button>
  );
});

export const SettingsToc = memo(function SettingsToc({
  toc,
  section,
  filtering,
  matchCount,
  onSelect,
  getPrerenderProps,
  className,
}: SettingsTocProps & { className?: string }) {
  return (
    <nav aria-label={m.theme_settings_toc_aria()} className={className}>
      <ul className="grid grid-cols-1 gap-px text-sm">
        {filtering && (
          <li>
            <TocButton
              kind="all"
              sectionKey={null}
              label={m.theme_settings_toc_all_results()}
              count={matchCount}
              modified={0}
              current={section === null}
              showCount
              onSelect={onSelect}
              getPrerenderProps={getPrerenderProps}
            />
          </li>
        )}
        {toc.map((group) => {
          const open = holdsSection(group, section);
          return (
            <li key={group.key}>
              <TocButton
                kind="group"
                sectionKey={group.key}
                label={group.label}
                count={group.count}
                modified={group.modified}
                current={group.key === section}
                open={open}
                expandable={group.subgroups.length > 0}
                showCount={filtering}
                onSelect={onSelect}
                getPrerenderProps={getPrerenderProps}
              />
              {open && group.subgroups.length > 0 && (
                <ul className="grid grid-cols-1 gap-px">
                  {group.subgroups.map((subgroup) => (
                    <li key={subgroup.key}>
                      <TocButton
                        kind="subgroup"
                        sectionKey={subgroup.key}
                        label={subgroup.label}
                        count={subgroup.count}
                        modified={subgroup.modified}
                        current={showsSection(subgroup, section)}
                        showCount={filtering}
                        onSelect={onSelect}
                        getPrerenderProps={getPrerenderProps}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
});

/** Stands in for the table of contents where there is no room beside the list. */
export function SettingsSectionSelect({
  toc,
  section,
  filtering,
  matchCount,
  onSelect,
  className,
}: SettingsTocProps & { className?: string }) {
  const id = useId();
  // Rendered again on every pick, while the options change only with a filter.
  const options = useMemo(() => {
    const optionLabel = (item: SettingsSection) =>
      filtering
        ? m.theme_settings_toc_option_with_count({
            label: item.label,
            count: item.count,
          })
        : item.label;
    return (
      <>
        {filtering && (
          <option value="">
            {m.theme_settings_toc_option_with_count({
              label: m.theme_settings_toc_all_results(),
              count: matchCount,
            })}
          </option>
        )}
        {toc.map((group) => (
          <Fragment key={group.key}>
            <option value={group.key}>{optionLabel(group)}</option>
            {group.subgroups.map((subgroup) => (
              <option key={subgroup.key} value={subgroup.key}>
                {`\u00a0\u00a0\u00a0${optionLabel(subgroup)}`}
              </option>
            ))}
          </Fragment>
        ))}
      </>
    );
  }, [toc, filtering, matchCount]);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Label htmlFor={id} className="shrink-0">
        {m.theme_settings_section_label()}
      </Label>
      <NativeSelect
        id={id}
        className="flex-1"
        value={section === null ? '' : getTocKey(toc, section)}
        onChange={(event) => onSelect(event.target.value || null)}
      >
        {options}
      </NativeSelect>
    </div>
  );
}
