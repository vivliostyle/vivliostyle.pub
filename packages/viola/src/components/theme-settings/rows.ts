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

/** A group or subgroup that the table of contents can select. */
export interface SettingsSection {
  key: string;
  groupId: string;
  subgroupId: string | null;
  label: string;
  /** Variables passing the filter. */
  count: number;
  modified: number;
}

export interface SettingsTocGroup extends SettingsSection {
  subgroupId: null;
  subgroups: SettingsSection[];
}

interface MatchedGroup {
  section: SettingsTocGroup;
  ungrouped: ThemeVariable[];
  subgroups: { section: SettingsSection; variables: ThemeVariable[] }[];
}

export interface SettingsMatches {
  groups: MatchedGroup[];
  /** Only the groups and subgroups that have matches. */
  toc: SettingsTocGroup[];
  matchCount: number;
}

export interface SettingsMatchInput {
  groups: readonly ThemeVariableGroup[];
  scope: ThemeScopeId;
  filter: SettingsFilter;
  isModified: (name: string) => boolean;
  getGroupLabel: (groupId: string) => string;
}

export type SettingsRow =
  | { kind: 'group'; key: string; label: string }
  | { kind: 'subgroup'; key: string; label: string }
  | { kind: 'variable'; key: string; variable: ThemeVariable }
  | { kind: 'more'; key: string; remaining: number };

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

export function matchSettings({
  groups,
  scope,
  filter,
  isModified,
  getGroupLabel,
}: SettingsMatchInput): SettingsMatches {
  const tokens = tokenizeQuery(filter.query);
  const countModified = (variables: ThemeVariable[]) =>
    variables.filter((v) => isModified(v.name)).length;
  const matched: MatchedGroup[] = [];
  let matchCount = 0;

  for (const group of groups) {
    if (!isVariableGroupInScope(scope, group.id)) {
      continue;
    }
    const label = getGroupLabel(group.id);
    const passes = (variable: ThemeVariable) =>
      (!filter.modifiedOnly || isModified(variable.name)) &&
      matchesQuery(variable, tokens, label);
    const ungrouped = group.ungrouped.filter(passes);
    const subgroups = group.subgroups.flatMap((subgroup) => {
      const variables = subgroup.variables.filter(passes);
      return variables.length > 0
        ? [
            {
              section: {
                key: subgroupKey(group.id, subgroup.id),
                groupId: group.id,
                subgroupId: subgroup.id,
                label: humanizeKey(subgroup.id),
                count: variables.length,
                modified: countModified(variables),
              },
              variables,
            },
          ]
        : [];
    });
    const sections = subgroups.map((subgroup) => subgroup.section);
    const count =
      ungrouped.length + sections.reduce((sum, s) => sum + s.count, 0);
    if (count === 0) {
      continue;
    }
    matchCount += count;
    matched.push({
      section: {
        key: groupKey(group.id),
        groupId: group.id,
        subgroupId: null,
        label,
        count,
        modified:
          countModified(ungrouped) +
          sections.reduce((sum, s) => sum + s.modified, 0),
        subgroups: sections,
      },
      ungrouped,
      subgroups,
    });
  }
  return {
    groups: matched,
    toc: matched.map((group) => group.section),
    matchCount,
  };
}

export function findSection(
  toc: readonly SettingsTocGroup[],
  key: string,
): SettingsSection | undefined {
  for (const group of toc) {
    if (group.key === key) {
      return group;
    }
    const subgroup = group.subgroups.find((s) => s.key === key);
    if (subgroup) {
      return subgroup;
    }
  }
  return undefined;
}

/**
 * Lists the rows of one section, or of every match when `sectionKey` is
 * `null`, up to `limit` variables, so that a huge group never mounts all of
 * its rows at once.
 */
export function buildSettingsRows(
  { groups }: SettingsMatches,
  sectionKey: string | null,
  limit: number,
): SettingsRow[] {
  const rows: SettingsRow[] = [];
  let emitted = 0;
  let remaining = 0;

  const pushHeader = (row: SettingsRow) => {
    if (emitted < limit) {
      rows.push(row);
    }
  };
  const pushVariables = (variables: ThemeVariable[]) => {
    for (const variable of variables) {
      if (emitted < limit) {
        rows.push({ kind: 'variable', key: variable.name, variable });
        emitted++;
      } else {
        remaining++;
      }
    }
  };

  for (const group of groups) {
    const { section } = group;
    const wholeGroup = sectionKey === null || sectionKey === section.key;
    if (
      !wholeGroup &&
      !group.subgroups.some((s) => s.section.key === sectionKey)
    ) {
      continue;
    }
    pushHeader({ kind: 'group', key: section.key, label: section.label });
    if (wholeGroup) {
      pushVariables(group.ungrouped);
    }
    for (const subgroup of group.subgroups) {
      if (wholeGroup || subgroup.section.key === sectionKey) {
        pushHeader({
          kind: 'subgroup',
          key: subgroup.section.key,
          label: subgroup.section.label,
        });
        pushVariables(subgroup.variables);
      }
    }
  }
  if (remaining > 0) {
    rows.push({ kind: 'more', key: 'more', remaining });
  }
  return rows;
}
