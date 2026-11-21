import {
  isVariableGroupInScope,
  type ThemeScopeId,
  type ThemeVariable,
  type ThemeVariableCategory,
  type ThemeVariableGroup,
  type ThemeVariableSubgroupRef,
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
  label: string;
  /** Variables passing the filter. */
  count: number;
  modified: number;
}

export interface SettingsTocGroup extends SettingsSection {
  subgroups: SettingsSection[];
}

/** A run of variables in a subgroup, headed by their category if labelled. */
interface MatchedPart {
  key: string;
  label: string | null;
  variables: ThemeVariable[];
}

interface MatchedGroup {
  section: SettingsTocGroup;
  subgroups: { section: SettingsSection; parts: MatchedPart[] }[];
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
  getCategoryLabel: (category: ThemeVariableCategory) => string;
  /** Labels a subgroup that a module lends to a group of another name. */
  qualifyLabel: (moduleLabel: string, label: string) => string;
}

export type SettingsRow =
  | { kind: 'group'; key: string; label: string }
  | { kind: 'subgroup'; key: string; label: string }
  | { kind: 'category'; key: string; label: string }
  | { kind: 'variable'; key: string; variable: ThemeVariable }
  | { kind: 'more'; key: string; remaining: number };

export const groupKey = (groupId: string) => `g:${groupId}`;

/** Key of a subgroup by the tree group it belongs to. */
export const subgroupKey = (
  treeGroup: string,
  { kind, id }: ThemeVariableSubgroupRef,
) => `s:${treeGroup}/${kind}:${id}`;

export function isFiltering(filter: SettingsFilter): boolean {
  return filter.query.trim() !== '' || filter.modifiedOnly;
}

export function tokenizeQuery(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Matches the tokens against a variable and the labels it is shown under. */
export function matchesQuery(
  variable: ThemeVariable,
  tokens: readonly string[],
  labels: readonly string[],
): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const haystack = [
    variable.name,
    variable.key,
    variable.group,
    ...labels,
    getVariableLabel(variable),
  ]
    .join('\n')
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

// Category headings only pay off once a target spans several categories.
function splitIntoParts(
  sectionKey: string,
  variables: ThemeVariable[],
  getCategoryLabel: (category: ThemeVariableCategory) => string,
): MatchedPart[] {
  const byCategory = new Map<ThemeVariableCategory, ThemeVariable[]>();
  for (const variable of variables) {
    const part = byCategory.get(variable.category);
    if (part) {
      part.push(variable);
    } else {
      byCategory.set(variable.category, [variable]);
    }
  }
  if (byCategory.size < 2) {
    return [{ key: sectionKey, label: null, variables }];
  }
  return [...byCategory].map(([category, part]) => ({
    key: `${sectionKey}/${category}`,
    label: getCategoryLabel(category),
    variables: part,
  }));
}

export function matchSettings({
  groups,
  scope,
  filter,
  isModified,
  getGroupLabel,
  getCategoryLabel,
  qualifyLabel,
}: SettingsMatchInput): SettingsMatches {
  const tokens = tokenizeQuery(filter.query);
  const countModified = (variables: ThemeVariable[]) =>
    variables.filter((v) => isModified(v.name)).length;
  const matched: MatchedGroup[] = [];
  let matchCount = 0;

  for (const group of groups) {
    const label = getGroupLabel(group.id);
    const subgroups = group.subgroups.flatMap((subgroup) => {
      if (!isVariableGroupInScope(scope, subgroup.group)) {
        return [];
      }
      const ownLabel =
        subgroup.kind === 'target'
          ? humanizeKey(subgroup.id)
          : getCategoryLabel(subgroup.id);
      const subgroupLabel = subgroup.module
        ? qualifyLabel(getGroupLabel(subgroup.module), ownLabel)
        : ownLabel;
      const variables = subgroup.variables.filter(
        (variable) =>
          (!filter.modifiedOnly || isModified(variable.name)) &&
          matchesQuery(variable, tokens, [label, subgroupLabel]),
      );
      if (variables.length === 0) {
        return [];
      }
      const key = subgroupKey(subgroup.group, subgroup);
      return [
        {
          section: {
            key,
            groupId: group.id,
            label: subgroupLabel,
            count: variables.length,
            modified: countModified(variables),
          },
          parts:
            subgroup.kind === 'target'
              ? splitIntoParts(key, variables, getCategoryLabel)
              : [{ key, label: null, variables }],
        },
      ];
    });
    const sections = subgroups.map((subgroup) => subgroup.section);
    const count = sections.reduce((sum, s) => sum + s.count, 0);
    if (count === 0) {
      continue;
    }
    matchCount += count;
    matched.push({
      section: {
        key: groupKey(group.id),
        groupId: group.id,
        label,
        count,
        modified: sections.reduce((sum, s) => sum + s.modified, 0),
        subgroups: sections,
      },
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
    for (const subgroup of group.subgroups) {
      if (wholeGroup || subgroup.section.key === sectionKey) {
        pushHeader({
          kind: 'subgroup',
          key: subgroup.section.key,
          label: subgroup.section.label,
        });
        for (const part of subgroup.parts) {
          if (part.label !== null) {
            pushHeader({ kind: 'category', key: part.key, label: part.label });
          }
          pushVariables(part.variables);
        }
      }
    }
  }
  if (remaining > 0) {
    rows.push({ kind: 'more', key: 'more', remaining });
  }
  return rows;
}
