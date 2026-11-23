import { memo, useCallback, useMemo } from 'react';

import { Button } from '@v/ui/button';
import { HoverPopover } from '@v/ui/hover-popover';
import { m } from '../../generated/paraglide/messages';
import {
  THEME_SCOPES,
  type ThemeCssModel,
  type ThemeScopeId,
} from '../../libs/theme-variables';
import { getPageContent } from './margin-box-content';
import {
  type MarginBoxContentGetter,
  MarginBoxPicker,
} from './margin-box-picker';
import type { WritingMode } from './margin-boxes';
import type { SettingsRow } from './rows';
import { SettingInfoCard } from './setting-info';
import { type CommitHandler, SettingRow } from './setting-row';

function SettingsList({
  rows,
  model,
  scope,
  getDefaultValue,
  getPageDefault,
  writingMode,
  onShowMore,
  onCommit,
  onSwitchScope,
  onSelectSection,
}: {
  rows: readonly SettingsRow[];
  model: ThemeCssModel;
  scope: ThemeScopeId;
  getDefaultValue: (name: string) => string | undefined;
  /** Defaults on a page of the preview, whichever scope the list edits. */
  getPageDefault: (
    pageClasses: readonly string[],
    name: string,
  ) => string | undefined;
  writingMode: WritingMode;
  onShowMore: () => void;
  onCommit: CommitHandler;
  onSwitchScope: (scope: ThemeScopeId) => void;
  onSelectSection: (section: string) => void;
}) {
  const variables = useMemo(
    () =>
      new Map(
        rows.flatMap((row) =>
          row.kind === 'variable' ? [[row.variable.name, row.variable]] : [],
        ),
      ),
    [rows],
  );
  const getContent = useCallback<MarginBoxContentGetter>(
    (cell, page) => getPageContent(cell, page, model, getPageDefault),
    [model, getPageDefault],
  );
  if (rows.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {m.theme_settings_no_results()}
      </p>
    );
  }
  return (
    <HoverPopover>
      <div className="grid">
        {rows.map((row) => {
          switch (row.kind) {
            case 'group':
              return (
                <h4
                  key={row.key}
                  className="mt-6 pb-1 text-lg font-semibold first:mt-0"
                >
                  {row.label}
                </h4>
              );
            case 'subgroup':
              return (
                <h5 key={row.key} className="mt-4 text-sm font-semibold">
                  {row.label}
                </h5>
              );
            case 'picker':
              return (
                <MarginBoxPicker
                  key={row.key}
                  boxes={row.boxes}
                  current={row.current}
                  onSelect={onSelectSection}
                  scope={scope}
                  writingMode={writingMode}
                  getContent={getContent}
                />
              );
            case 'category':
              return (
                <h6
                  key={row.key}
                  className="mt-3 text-xs font-medium text-muted-foreground"
                >
                  {row.label}
                </h6>
              );
            case 'variable': {
              const { name } = row.variable;
              const entry = model.scopes[scope].variables[name];
              return (
                <SettingRow
                  // Remount per scope so that a pending draft or error does
                  // not carry over to another scope's value.
                  key={`${scope}:${row.key}`}
                  variable={row.variable}
                  scope={scope}
                  value={entry?.value}
                  defaultValue={getDefaultValue(name)}
                  otherScopes={THEME_SCOPES.filter(
                    (s) => s.id !== scope && model.scopes[s.id].variables[name],
                  ).map((s) => s.id)}
                  onCommit={onCommit}
                  onSwitchScope={onSwitchScope}
                />
              );
            }
            case 'more':
              return (
                <Button
                  key={row.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 justify-self-center"
                  onClick={onShowMore}
                >
                  {m.theme_settings_show_more_count({ count: row.remaining })}
                </Button>
              );
            default:
              return null;
          }
        })}
      </div>
      <SettingInfoCard
        getVariable={(name) => variables.get(name)}
        isImportant={(name) =>
          model.scopes[scope].variables[name]?.important ?? false
        }
      />
    </HoverPopover>
  );
}

// Skipped when only the table of contents changes, as on a pick.
const MemoizedSettingsList = memo(SettingsList);

export { MemoizedSettingsList as SettingsList };
