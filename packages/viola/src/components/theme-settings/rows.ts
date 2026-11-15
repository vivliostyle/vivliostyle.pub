import {
  isVariableGroupInScope,
  type ThemeScopeId,
  type ThemeVariable,
  type ThemeVariableGroup,
} from '../../libs/theme-variables';
import { getVariableLabel, humanizeKey } from './labels';

export interface SettingsFilter {
  query: string;
  modifiedOnly: boolean;
}

export type SettingsRow =
  | {
      kind: 'group';
      key: string;
      groupId: string;
      label: string;
      count: number;
      modified: number;
      expanded: boolean;
    }
  | {
      kind: 'subgroup';
      key: string;
      groupId: string;
      subgroupId: string;
      label: string;
      count: number;
      modified: number;
      expanded: boolean;
    }
  | { kind: 'variable'; key: string; variable: ThemeVariable; nested: boolean }
  /** `remaining` counts hidden variables, not hidden collapsed headers. */
  | { kind: 'more'; key: string; remaining: number };

export interface SettingsRowsInput {
  groups: readonly ThemeVariableGroup[];
  scope: ThemeScopeId;
  filter: SettingsFilter;
  isModified: (name: string) => boolean;
  isExpanded: (key: string) => boolean;
  /** Maximum number of variable rows to emit. */
  limit: number;
  getGroupLabel: (groupId: string) => string;
}

export interface SettingsRows {
  rows: SettingsRow[];
  /** Variables passing the filter, collapsed or not. */
  matchCount: number;
}

export const groupKey = (groupId: string) => `g:${groupId}`;

export const subgroupKey = (groupId: string, subgroupId: string) =>
  `s:${groupId}/${subgroupId}`;

export function isFiltering(filter: SettingsFilter): boolean {
  return filter.query.trim() !== '' || filter.modifiedOnly;
}

export function tokenizeQuery(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesQuery(
  variable: ThemeVariable,
  tokens: readonly string[],
  groupLabel: string,
): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const haystack = [
    variable.name,
    variable.key,
    variable.group,
    groupLabel,
    variable.subgroup ? humanizeKey(variable.subgroup) : '',
    getVariableLabel(variable),
  ]
    .join('\n')
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Flattens the schema tree into the rows to render: headers of the groups and
 * subgroups that have matches, and the variables of the expanded ones up to
 * `limit`, so that a huge group never mounts all of its rows at once.
 */
export function buildSettingsRows({
  groups,
  scope,
  filter,
  isModified,
  isExpanded,
  limit,
  getGroupLabel,
}: SettingsRowsInput): SettingsRows {
  const tokens = tokenizeQuery(filter.query);
  const rows: SettingsRow[] = [];
  let matchCount = 0;
  let emitted = 0;
  let remaining = 0;
  let truncated = false;

  const push = (row: SettingsRow) => {
    if (emitted < limit) {
      rows.push(row);
    } else {
      truncated = true;
    }
  };
  const pushVariables = (variables: ThemeVariable[], nested: boolean) => {
    for (const variable of variables) {
      if (emitted < limit) {
        rows.push({ kind: 'variable', key: variable.name, variable, nested });
        emitted++;
      } else {
        remaining++;
        truncated = true;
      }
    }
  };
  const countModified = (variables: ThemeVariable[]) =>
    variables.filter((v) => isModified(v.name)).length;

  for (const group of groups) {
    if (!isVariableGroupInScope(scope, group.id)) {
      continue;
    }
    const label = getGroupLabel(group.id);
    const passes = (variable: ThemeVariable) =>
      (!filter.modifiedOnly || isModified(variable.name)) &&
      matchesQuery(variable, tokens, label);
    const ungrouped = group.ungrouped.filter(passes);
    const subgroups = group.subgroups
      .map((subgroup) => ({
        id: subgroup.id,
        variables: subgroup.variables.filter(passes),
      }))
      .filter((subgroup) => subgroup.variables.length > 0);
    const count =
      ungrouped.length +
      subgroups.reduce((sum, s) => sum + s.variables.length, 0);
    if (count === 0) {
      continue;
    }
    matchCount += count;

    const key = groupKey(group.id);
    const expanded = isExpanded(key);
    push({
      kind: 'group',
      key,
      groupId: group.id,
      label,
      count,
      modified:
        countModified(ungrouped) +
        subgroups.reduce((sum, s) => sum + countModified(s.variables), 0),
      expanded,
    });
    if (!expanded) {
      continue;
    }
    pushVariables(ungrouped, false);
    for (const subgroup of subgroups) {
      const key = subgroupKey(group.id, subgroup.id);
      const expanded = isExpanded(key);
      push({
        kind: 'subgroup',
        key,
        groupId: group.id,
        subgroupId: subgroup.id,
        label: humanizeKey(subgroup.id),
        count: subgroup.variables.length,
        modified: countModified(subgroup.variables),
        expanded,
      });
      if (expanded) {
        pushVariables(subgroup.variables, true);
      }
    }
  }
  if (truncated) {
    rows.push({ kind: 'more', key: 'more', remaining });
  }
  return { rows, matchCount };
}
