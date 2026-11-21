import { memo, useCallback, useId, useMemo, useState } from 'react';

import { Button } from '@v/ui/button';
import { RotateCcw } from '@v/ui/icon';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import {
  describeVariable,
  getThemeScope,
  type ThemeScopeId,
  type ThemeVariable,
  type ValueDescriptor,
} from '../../libs/theme-variables';
import type { CommitError } from './commit';
import { ValueField } from './fields';
import { getVariableLabel } from './labels';
import { getCommitErrorMessage, getScopeLabel } from './messages';
import { SettingInfo } from './setting-info';

export type CommitHandler = (
  scope: ThemeScopeId,
  name: string,
  descriptor: ValueDescriptor,
  value: string,
) => CommitError | null;

interface SettingRowProps {
  variable: ThemeVariable;
  scope: ThemeScopeId;
  /** `undefined` when the scope does not set the variable. */
  value: string | undefined;
  /** Value in effect when no scope sets the variable. */
  defaultValue: string | undefined;
  important: boolean;
  /** Other scopes that set the variable. */
  otherScopes: readonly ThemeScopeId[];
  onCommit: CommitHandler;
  onSwitchScope: (scope: ThemeScopeId) => void;
}

function SettingRow({
  variable,
  scope,
  value,
  defaultValue,
  important,
  otherScopes,
  onCommit,
  onSwitchScope,
}: SettingRowProps) {
  const descriptor = useMemo(() => describeVariable(variable), [variable]);
  const label = getVariableLabel(variable);
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const [error, setError] = useState<CommitError | null>(null);
  const modified = value !== undefined;

  const commit = useCallback(
    (next: string) =>
      setError(onCommit(scope, variable.name, descriptor, next)),
    [onCommit, scope, variable.name, descriptor],
  );
  const revert = useCallback(() => setError(null), []);

  const describedBy =
    [defaultValue && hintId, error && errorId].filter(Boolean).join(' ') ||
    undefined;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would restyle the row and its legend.
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn(
        'grid gap-1.5 border-l-2 py-2 pr-1 pl-3',
        modified ? 'border-primary' : 'border-transparent',
      )}
    >
      <div className="flex items-start gap-2">
        <SettingInfo
          variable={variable}
          descriptor={descriptor}
          label={label}
          important={important}
        >
          <div id={labelId} className="min-w-0 text-sm font-medium">
            {label}
            {modified && (
              <span className="sr-only">
                {' '}
                ({m.theme_settings_modified_indicator()})
              </span>
            )}
          </div>
        </SettingInfo>
        {modified && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-my-0.5 ml-auto size-6 shrink-0"
            aria-label={m.theme_settings_reset_aria({ name: label })}
            title={m.theme_settings_reset_aria({ name: label })}
            onClick={() => commit('')}
          >
            <RotateCcw />
          </Button>
        )}
      </div>
      {otherScopes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{m.theme_settings_also_set_in()}</span>
          {otherScopes.map((other) => (
            <button
              key={other}
              type="button"
              className="cursor-pointer rounded border px-1 font-mono hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={m.theme_settings_also_set_in_aria({
                scope: getScopeLabel(other),
              })}
              title={getScopeLabel(other)}
              onClick={() => onSwitchScope(other)}
            >
              {getThemeScope(other).label}
            </button>
          ))}
        </div>
      )}
      <div className="max-w-lg">
        <ValueField
          value={value ?? ''}
          descriptor={descriptor}
          defaultValue={defaultValue}
          label={label}
          labelId={labelId}
          describedBy={describedBy}
          invalid={error !== null}
          onCommit={commit}
          onRevert={revert}
        />
      </div>
      {defaultValue && (
        <p
          id={hintId}
          className="break-all font-mono text-xs text-muted-foreground"
        >
          {m.theme_settings_default_hint({ value: defaultValue })}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {getCommitErrorMessage(error)}
        </p>
      )}
    </div>
  );
}

function arePropsEqual(prev: SettingRowProps, next: SettingRowProps) {
  return (Object.keys(next) as (keyof SettingRowProps)[]).every((key) =>
    key === 'otherScopes'
      ? prev.otherScopes.join() === next.otherScopes.join()
      : Object.is(prev[key], next[key]),
  );
}

const MemoizedSettingRow = memo(SettingRow, arePropsEqual);

export { MemoizedSettingRow as SettingRow };
