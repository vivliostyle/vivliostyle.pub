import { memo, useId, useState } from 'react';
import { useDebounce } from 'react-use';

import { Button } from '@v/ui/button';
import { Checkbox } from '@v/ui/checkbox';
import { Search, X } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { Label } from '@v/ui/label';
import { m } from '../../generated/paraglide/messages';
import {
  getThemeScope,
  THEME_SCOPES,
  type ThemeScopeId,
} from '../../libs/theme-variables';
import { getScopeLabel } from './messages';
import { NativeSelect } from './native-select';

const SEARCH_DEBOUNCE_MS = 200;

// Holds the text being typed, so that a keystroke re-renders only the field
// and the settings only see the query once typing pauses.
function SearchField({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [text, setText] = useState(query);
  useDebounce(() => onQueryChange(text), SEARCH_DEBOUNCE_MS, [text]);
  const clear = () => {
    setText('');
    onQueryChange('');
  };

  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={m.theme_settings_search_aria()}
        placeholder={m.theme_settings_search_placeholder()}
        className="px-8 [&::-webkit-search-cancel-button]:hidden"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text !== '') {
            event.preventDefault();
            clear();
          }
        }}
      />
      {text !== '' && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute inset-y-0 right-0.5 my-auto size-8"
          aria-label={m.theme_settings_search_clear_aria()}
          onClick={clear}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

function SettingsToolbar({
  query,
  onQueryChange,
  scope,
  onScopeChange,
  scopeCounts,
  modifiedOnly,
  onModifiedOnlyChange,
  showAdvanced,
  onShowAdvancedChange,
  matchCount,
}: {
  /** The query in effect, which the field starts from when it mounts. */
  query: string;
  /** Called once typing pauses, or right away when the search is cleared. */
  onQueryChange: (query: string) => void;
  scope: ThemeScopeId;
  onScopeChange: (scope: ThemeScopeId) => void;
  /** Schema variables each scope sets. */
  scopeCounts: Readonly<Record<ThemeScopeId, number>>;
  modifiedOnly: boolean;
  onModifiedOnlyChange: (modifiedOnly: boolean) => void;
  showAdvanced: boolean;
  onShowAdvancedChange: (showAdvanced: boolean) => void;
  /** `null` while no filter is active. */
  matchCount: number | null;
}) {
  const scopeSelectId = useId();
  const modifiedOnlyId = useId();
  const showAdvancedId = useId();
  const pageOnly = getThemeScope(scope).variableGroups !== null;

  return (
    <div className="grid gap-2">
      <SearchField query={query} onQueryChange={onQueryChange} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Label htmlFor={scopeSelectId} className="shrink-0">
            {m.theme_settings_scope_label()}
          </Label>
          <NativeSelect
            id={scopeSelectId}
            className="flex-1"
            value={scope}
            onChange={(event) =>
              onScopeChange(event.target.value as ThemeScopeId)
            }
          >
            {THEME_SCOPES.map(({ id, label: rule }) => {
              const label = getScopeLabel(id);
              const count = scopeCounts[id];
              return (
                <option key={id} value={id}>
                  {count > 0
                    ? m.theme_settings_scope_option_with_count({
                        scope: label,
                        rule,
                        count,
                      })
                    : m.theme_settings_scope_option({ scope: label, rule })}
                </option>
              );
            })}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={modifiedOnlyId}
            checked={modifiedOnly}
            onCheckedChange={(checked) =>
              onModifiedOnlyChange(checked === true)
            }
          />
          <Label htmlFor={modifiedOnlyId}>
            {m.theme_settings_modified_only()}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={showAdvancedId}
            checked={showAdvanced}
            onCheckedChange={(checked) =>
              onShowAdvancedChange(checked === true)
            }
          />
          <Label htmlFor={showAdvancedId}>
            {m.theme_settings_show_advanced()}
          </Label>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <p aria-live="polite">
          {matchCount !== null &&
            m.theme_settings_result_count({ count: matchCount })}
        </p>
        {pageOnly && <p>{m.theme_settings_scope_page_note()}</p>}
      </div>
    </div>
  );
}

const MemoizedSettingsToolbar = memo(SettingsToolbar);

export { MemoizedSettingsToolbar as SettingsToolbar };
