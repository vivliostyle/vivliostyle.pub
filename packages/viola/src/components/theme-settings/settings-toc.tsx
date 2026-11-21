import { Fragment, useId } from 'react';

import { ChevronRight } from '@v/ui/icon';
import { Label } from '@v/ui/label';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import { NativeSelect } from './native-select';
import type { SettingsSection, SettingsTocGroup } from './rows';

export interface SettingsTocProps {
  toc: readonly SettingsTocGroup[];
  /** `null` while every match shows, which only a filter allows. */
  section: string | null;
  filtering: boolean;
  matchCount: number;
  onSelect: (section: string | null) => void;
}

const holdsSection = (group: SettingsTocGroup, section: string | null) =>
  group.key === section || group.subgroups.some((s) => s.key === section);

function ModifiedDot({ count }: { count: number }) {
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

function TocButton({
  label,
  count,
  modified,
  current,
  showCount,
  className,
  onClick,
  children,
}: {
  label: string;
  count: number;
  modified: number;
  current: boolean;
  showCount: boolean;
  className?: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={current || undefined}
      className={cn(
        'flex w-full cursor-pointer items-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        current && 'bg-accent font-medium text-accent-foreground',
        className,
      )}
      onClick={onClick}
    >
      {children && (
        <span className="flex h-lh shrink-0 items-center">{children}</span>
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
}

export function SettingsToc({
  toc,
  section,
  filtering,
  matchCount,
  onSelect,
  className,
}: SettingsTocProps & { className?: string }) {
  const select = (item: SettingsSection) => () => onSelect(item.key);
  return (
    <nav aria-label={m.theme_settings_toc_aria()} className={className}>
      <ul className="grid grid-cols-1 gap-px text-sm">
        {filtering && (
          <li>
            <TocButton
              label={m.theme_settings_toc_all_results()}
              count={matchCount}
              modified={0}
              current={section === null}
              showCount
              className="pl-6"
              onClick={() => onSelect(null)}
            />
          </li>
        )}
        {toc.map((group) => {
          const open = holdsSection(group, section);
          return (
            <li key={group.key}>
              <TocButton
                label={group.label}
                count={group.count}
                modified={group.modified}
                current={group.key === section}
                showCount={filtering}
                className={cn(open && 'font-medium')}
                onClick={select(group)}
              >
                <ChevronRight
                  aria-hidden
                  className={cn(
                    'size-3.5 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-90',
                    group.subgroups.length === 0 && 'invisible',
                  )}
                />
              </TocButton>
              {open && group.subgroups.length > 0 && (
                <ul className="grid grid-cols-1 gap-px">
                  {group.subgroups.map((subgroup) => (
                    <li key={subgroup.key}>
                      <TocButton
                        label={subgroup.label}
                        count={subgroup.count}
                        modified={subgroup.modified}
                        current={subgroup.key === section}
                        showCount={filtering}
                        className="pl-6 text-xs"
                        onClick={select(subgroup)}
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
}

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
  const optionLabel = (item: SettingsSection) =>
    filtering
      ? m.theme_settings_toc_option_with_count({
          label: item.label,
          count: item.count,
        })
      : item.label;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Label htmlFor={id} className="shrink-0">
        {m.theme_settings_section_label()}
      </Label>
      <NativeSelect
        id={id}
        className="flex-1"
        value={section ?? ''}
        onChange={(event) => onSelect(event.target.value || null)}
      >
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
                {`   ${optionLabel(subgroup)}`}
              </option>
            ))}
          </Fragment>
        ))}
      </NativeSelect>
    </div>
  );
}
