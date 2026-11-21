import { Button } from '@v/ui/button';
import { m } from '../../generated/paraglide/messages';
import {
  THEME_SCOPES,
  type ThemeCssModel,
  type ThemeScopeId,
} from '../../libs/theme-variables';
import type { SettingsRow } from './rows';
import { type CommitHandler, SettingRow } from './setting-row';

export function SettingsList({
  rows,
  model,
  scope,
  getDefaultValue,
  onShowMore,
  onCommit,
  onSwitchScope,
}: {
  rows: readonly SettingsRow[];
  model: ThemeCssModel;
  scope: ThemeScopeId;
  getDefaultValue: (name: string) => string | undefined;
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
                important={entry?.important ?? false}
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
  );
}
