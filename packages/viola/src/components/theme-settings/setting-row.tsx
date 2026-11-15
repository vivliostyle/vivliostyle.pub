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
  important: boolean;
  /** Other scopes that set the variable. */
  otherScopes: readonly ThemeScopeId[];
  nested: boolean;
  onCommit: CommitHandler;
  onSwitchScope: (scope: ThemeScopeId) => void;
}

function SettingRow({
  variable,
  scope,
  value,
  important,
  otherScopes,
  nested,
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
    [variable.defaultValue && hintId, error && errorId]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would restyle the row and its legend.
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn(
        'grid gap-1.5 border-l-2 py-3 pr-1 pl-3',
        nested && 'ml-3',
        modified ? 'border-primary' : 'border-transparent',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div id={labelId} className="text-sm font-medium">
            {label}
            {modified && (
              <span className="sr-only">
                {' '}
                ({m.theme_settings_modified_indicator()})
              </span>
            )}
          </div>
          <code
            className="block truncate text-xs text-muted-foreground select-all"
            title={variable.name}
          >
            {variable.name}
            {important && ' !important'}
          </code>
        </div>
        {modified && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
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
      <ValueField
        value={value ?? ''}
        descriptor={descriptor}
        defaultValue={variable.defaultValue}
        label={label}
        labelId={labelId}
        describedBy={describedBy}
        invalid={error !== null}
        onCommit={commit}
        onRevert={revert}
      />
      {variable.defaultValue && (
        <p
          id={hintId}
          className="break-all font-mono text-xs text-muted-foreground"
        >
          {m.theme_settings_default_hint({ value: variable.defaultValue })}
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
