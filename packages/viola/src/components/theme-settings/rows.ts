import { m } from '../../generated/paraglide/messages';
import {
  isVariableGroupInScope,
  type ThemeScopeId,
  type ThemeVariable,
  type ThemeVariableCategory,
  type ThemeVariableGroup,
  type ThemeVariableSubgroup,
  type ThemeVariableSubgroupRef,
} from '../../libs/theme-variables';
import { getTargetLabel, getVariableLabel } from './labels';
import {
  ALL_MARGIN_BOXES,
  findSpreadSideBox,
  getMarginBox,
} from './margin-boxes';

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
  /** The sections an entry of the table of contents stands for together. */
  members?: readonly SettingsSection[];
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

interface MatchedSubgroup {
  section: SettingsSection;
  parts: MatchedPart[];
  /** The margin box the subgroup sets, if any. */
  box: string | null;
}

type MatchedBox = MatchedSubgroup & { box: string };

const isBox = (subgroup: MatchedSubgroup): subgroup is MatchedBox =>
  subgroup.box !== null;

interface MatchedGroup {
  section: SettingsTocGroup;
  subgroups: MatchedSubgroup[];
}

/** A margin box that the diagram of a page can pick. */
export interface MarginBoxOption {
  key: string;
  id: string;
  count: number;
  modified: number;
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
  /** Whether to list the variables marked as advanced. */
  showAdvanced: boolean;
  getGroupLabel: (groupId: string) => string;
  getCategoryLabel: (category: ThemeVariableCategory) => string;
  /** Labels a subgroup that a module lends to a group of another name. */
  qualifyLabel: (moduleLabel: string, label: string) => string;
}

export type SettingsRow =
  | { kind: 'group'; key: string; label: string }
  | { kind: 'subgroup'; key: string; label: string }
  | { kind: 'category'; key: string; label: string }
  | {
      kind: 'picker';
      key: string;
      current: string;
      boxes: readonly MarginBoxOption[];
    }
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

// The shared box opens the margin boxes, as every other one falls back to it.
const leadBox = (boxes: readonly MatchedBox[]) =>
  boxes.find((s) => s.box === ALL_MARGIN_BOXES) ?? boxes[0];

// A page has some twenty margin boxes, which would bury the rest of the page
// settings as entries of their own.
function getTocSections(subgroups: readonly MatchedSubgroup[]) {
  const boxes = subgroups.filter(isBox);
  if (boxes.length === 0) {
    return subgroups.map((s) => s.section);
  }
  const members = boxes.map((s) => s.section);
  const entry: SettingsSection = {
    key: leadBox(boxes).section.key,
    groupId: members[0].groupId,
    label: m.theme_settings_margin_boxes(),
    count: members.reduce((sum, s) => sum + s.count, 0),
    modified: members.reduce((sum, s) => sum + s.modified, 0),
    members,
  };
  return subgroups.flatMap((s) =>
    s.box === null ? [s.section] : s === boxes[0] ? [entry] : [],
  );
}

// theme-base sets what the boxes show on either side of a spread among the
// settings of the shared boxes, where it reads as a setting of those boxes.
function splitSpreadSides(
  subgroup: ThemeVariableSubgroup,
): ThemeVariableSubgroup[] {
  if (getMarginBox(subgroup) === null) {
    return [subgroup];
  }
  const own: ThemeVariable[] = [];
  const sides = new Map<string, ThemeVariable[]>();
  for (const variable of subgroup.variables) {
    const box = findSpreadSideBox(variable.name);
    if (box === null) {
      own.push(variable);
    } else {
      sides.set(box, [...(sides.get(box) ?? []), variable]);
    }
  }
  return [
    { ...subgroup, variables: own },
    ...[...sides].map(
      ([id, variables]): ThemeVariableSubgroup => ({
        kind: 'target',
        id,
        group: subgroup.group,
        module: subgroup.module,
        variables,
      }),
    ),
  ];
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
  showAdvanced,
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
    const subgroups = group.subgroups
      .flatMap(splitSpreadSides)
      .flatMap((subgroup): MatchedSubgroup[] => {
        const ownLabel =
          subgroup.kind === 'target'
            ? getTargetLabel(subgroup.group, subgroup.id)
            : getCategoryLabel(subgroup.id);
        const subgroupLabel = subgroup.module
          ? qualifyLabel(getGroupLabel(subgroup.module), ownLabel)
          : ownLabel;
        const variables = subgroup.variables.filter(
          (variable) =>
            isVariableGroupInScope(scope, variable.group) &&
            (!filter.modifiedOnly || isModified(variable.name)) &&
            // A search looks through them all, to find a setting by its name.
            (showAdvanced ||
              !variable.advanced ||
              tokens.length > 0 ||
              isModified(variable.name)) &&
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
            box: getMarginBox(subgroup),
          },
        ];
      });
    const sections = getTocSections(subgroups);
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
    for (const subgroup of group.subgroups) {
      const section = [subgroup, ...(subgroup.members ?? [])].find(
        (s) => s.key === key,
      );
      if (section) {
        return section;
      }
    }
  }
  return undefined;
}

/** Key of the entry of the table of contents that shows a section. */
export function getTocKey(
  toc: readonly SettingsTocGroup[],
  key: string,
): string {
  for (const group of toc) {
    const entry = group.subgroups.find((s) =>
      s.members?.some((member) => member.key === key),
    );
    if (entry) {
      return entry.key;
    }
  }
  return key;
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
    const everything = sectionKey === null;
    const wholeGroup = everything || sectionKey === section.key;
    if (
      !wholeGroup &&
      !group.subgroups.some((s) => s.section.key === sectionKey)
    ) {
      continue;
    }
    // Outside a search, the margin boxes list one box at a time, picked on
    // the diagram of a page.
    const boxes = group.subgroups.filter(isBox);
    const shownBox = everything
      ? undefined
      : (boxes.find((s) => s.section.key === sectionKey) ??
        (wholeGroup && boxes.length > 0 ? leadBox(boxes) : undefined));
    pushHeader({ kind: 'group', key: section.key, label: section.label });
    for (const subgroup of group.subgroups) {
      if (subgroup.box !== null && !everything) {
        if (subgroup !== shownBox) {
          continue;
        }
        pushHeader({
          kind: 'picker',
          key: `${section.key}/picker`,
          current: subgroup.section.key,
          boxes: boxes.map((s) => ({
            key: s.section.key,
            id: s.box,
            count: s.section.count,
            modified: s.section.modified,
          })),
        });
      } else if (!wholeGroup && subgroup.section.key !== sectionKey) {
        continue;
      }
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
  if (remaining > 0) {
    rows.push({ kind: 'more', key: 'more', remaining });
  }
  return rows;
}
