import { Button } from '@v/ui/button';
import { ChevronRight } from '@v/ui/icon';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import {
  THEME_SCOPES,
  type ThemeCssModel,
  type ThemeScopeId,
} from '../../libs/theme-variables';
import type { SettingsRow } from './rows';
import { type CommitHandler, SettingRow } from './setting-row';

function HeaderButton({
  row,
  onToggle,
}: {
  row: Extract<SettingsRow, { kind: 'group' | 'subgroup' }>;
  onToggle: (key: string) => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        row.kind === 'group' ? 'font-semibold' : 'text-sm font-medium',
      )}
      onClick={() => onToggle(row.key)}
    >
      <ChevronRight
        aria-hidden
        className={cn(
          'size-4 shrink-0 transition-transform',
          row.expanded && 'rotate-90',
        )}
      />
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      {row.modified > 0 && (
        <span className="shrink-0 text-xs font-normal text-primary">
          {m.theme_settings_group_modified_count({ count: row.modified })}
        </span>
      )}
      <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
        {row.count}
      </span>
    </button>
  );
}

export function SettingsList({
  rows,
  model,
  scope,
  onToggle,
  onShowMore,
  onCommit,
  onSwitchScope,
}: {
  rows: readonly SettingsRow[];
  model: ThemeCssModel;
  scope: ThemeScopeId;
  onToggle: (key: string) => void;
  onShowMore: () => void;
  onCommit: CommitHandler;
  onSwitchScope: (scope: ThemeScopeId) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {m.theme_settings_no_results()}
      </p>
    );
  }
  return (
    <div className="grid">
      {rows.map((row) => {
        switch (row.kind) {
          case 'group':
            return (
              <h4 key={row.key} className="mt-2 first:mt-0">
                <HeaderButton row={row} onToggle={onToggle} />
              </h4>
            );
          case 'subgroup':
            return (
              <h5 key={row.key} className="ml-3">
                <HeaderButton row={row} onToggle={onToggle} />
              </h5>
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
                important={entry?.important ?? false}
                otherScopes={THEME_SCOPES.filter(
                  (s) => s.id !== scope && model.scopes[s.id].variables[name],
                ).map((s) => s.id)}
                nested={row.nested}
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
                {row.remaining > 0
                  ? m.theme_settings_show_more_count({ count: row.remaining })
                  : m.theme_settings_show_more()}
              </Button>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
