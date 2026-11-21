import { groupedPropAlias } from 'postcss-variable-theming/preset';

import {
  getLeadingCategory,
  getTrailingCategory,
  THEME_VARIABLE_CATEGORIES,
  type ThemeVariableCategory,
} from './categories';
import {
  BASIC_GROUP,
  getForeignModule,
  getSettingsGroupId,
  getSettingsGroupRank,
  getSourceRank,
  META_GROUP,
} from './subjects';

export interface ThemeVariableDefault {
  value: string;
  /** Selector the default is declared on; `:root` when omitted. */
  selector?: string;
  /** Media query the default is limited to. */
  media?: string;
}

export interface ThemeVariable {
  name: string;
  path: readonly string[];
  /** Top-level key of the tree: `_meta-properties`, `_basic` or a module. */
  group: string;
  subgroup: ThemeVariableSubgroupRef;
  /** Name without the `--vs-` prefix of its group. */
  key: string;
  /**
   * Leading part of `key` naming what the variable styles, like `h1` of
   * `h1-font-size`; `null` for a variable of the group as a whole.
   */
  target: string | null;
  /** `key` without its target, like `font-size` of `h1-font-size`. */
  propertyKey: string;
  /** What the variable sets, judged by the property it feeds. */
  category: ThemeVariableCategory;
  /** `@property`-like syntax; an approximation of the consuming properties. */
  syntax: string;
  /** CSS properties the variable ends up in. */
  properties: readonly string[];
  /** Default declared unconditionally on `:root`. */
  defaultValue?: string;
  /** Defaults limited to a selector and/or a media query. */
  conditionalDefaults: readonly ThemeVariableDefault[];
}

/**
 * A section of a group: the variables styling one target, or those of the
 * group as a whole that set one category.
 */
export type ThemeVariableSubgroupRef =
  | { kind: 'target'; id: string }
  | { kind: 'category'; id: ThemeVariableCategory };

export type ThemeVariableSubgroup = ThemeVariableSubgroupRef & {
  /** Tree group the subgroup belongs to. */
  group: string;
  /** Module to name in the label of the subgroup, if any. */
  module: string | null;
  /** In source order, or by category within a target. */
  variables: ThemeVariable[];
};

/**
 * A group of the settings: a group of the tree, or a subject that gathers
 * parts of several, like the styles and the numbering of tables.
 */
export interface ThemeVariableGroup {
  id: string;
  /** Every variable of the group, in source order. */
  variables: ThemeVariable[];
  /**
   * Elements in the order of their subject, then each tree group with its
   * categories in their order and its targets in source order.
   */
  subgroups: ThemeVariableSubgroup[];
}

export interface ThemeVariableSchema {
  variables: ThemeVariable[];
  groups: ThemeVariableGroup[];
  byName: ReadonlyMap<string, ThemeVariable>;
}

interface RawDefault {
  value: string;
  selector?: string;
  media?: string;
}

interface RawVariable {
  _syntax: string;
  _property?: string | string[];
  _define?: string | RawDefault[];
}

// The aliases theme-base generates variable names with. The `color` entry
// comes from its own build config rather than the preset.
const PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  ...groupedPropAlias,
  color: 'text-color',
};

// A target with fewer variables would make a section of a single row.
const MIN_TARGET_SIZE = 2;

type ThemeVariableBase = Omit<
  ThemeVariable,
  'target' | 'propertyKey' | 'category' | 'subgroup'
>;

interface KeySplit extends Pick<ThemeVariable, 'target' | 'propertyKey'> {
  /** Property the name was generated from, if it was. */
  source?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRawVariable(value: unknown): value is RawVariable {
  return isRecord(value) && typeof value._syntax === 'string';
}

/**
 * Maps a tree path to its custom property: `_meta-properties` holds the
 * document-wide `--vs-*` tokens, `_basic` the `--vs--*` element variables,
 * and every other group the `--vs-<module>--*` variables of a module.
 */
export function getThemeVariableName(path: readonly string[]): string {
  const [group, ...rest] = path;
  const key = rest.join('-');
  if (group === META_GROUP) {
    return `--vs-${key}`;
  }
  return group === BASIC_GROUP ? `--vs--${key}` : `--vs-${group}--${key}`;
}

/**
 * Splits a key the way theme-base's `@var` blocks generate it: a target, a
 * dash, and the aliased name of the property the variable is used in.
 */
function splitByProperty(
  key: string,
  properties: readonly string[],
): KeySplit | null {
  let match: { name: string; property: string } | undefined;
  for (const property of properties) {
    const name = PROPERTY_ALIASES[property] ?? property;
    if (
      (key === name || key.endsWith(`-${name}`)) &&
      name.length > (match?.name.length ?? 0)
    ) {
      match = { name, property };
    }
  }
  if (match === undefined) {
    return null;
  }
  return {
    target: key === match.name ? null : key.slice(0, -match.name.length - 1),
    propertyKey: match.name,
    source: match.property,
  };
}

// Names written by hand follow no rule, so they reuse the targets of the
// generated names in their group.
function splitByTarget(key: string, targets: Iterable<string>): KeySplit {
  let target: string | null = null;
  for (const candidate of targets) {
    if (
      key.startsWith(`${candidate}-`) &&
      candidate.length > (target?.length ?? 0)
    ) {
      target = candidate;
    }
  }
  return {
    target,
    propertyKey: target === null ? key : key.slice(target.length + 1),
  };
}

function splitKeys(variables: readonly ThemeVariableBase[]): KeySplit[] {
  const generated = variables.map((v) => splitByProperty(v.key, v.properties));
  const targets = new Map<string, Set<string>>();
  variables.forEach((variable, index) => {
    const target = generated[index]?.target;
    if (target) {
      const known = targets.get(variable.group) ?? new Set();
      targets.set(variable.group, known.add(target));
    }
  });
  return variables.map(
    (variable, index) =>
      generated[index] ??
      splitByTarget(variable.key, targets.get(variable.group) ?? []),
  );
}

function categorize(
  { source, propertyKey }: KeySplit,
  properties: readonly string[],
): ThemeVariableCategory {
  // The source goes first, since an alias can read as another property
  // (`size-inline` of `inline-size` as `size`).
  return (
    (source === undefined ? undefined : getLeadingCategory(source)) ??
    getLeadingCategory(propertyKey) ??
    properties.map(getLeadingCategory).find(Boolean) ??
    getTrailingCategory(propertyKey) ??
    'other'
  );
}

/**
 * Picks the target section of each variable, or `null` to list it under its
 * category. A target too small for a section joins the nearest target whose
 * name leads its own, or else the group's own variables of its category. With
 * neither, it keeps a section of its own, since a category section holding it
 * alone would read as a setting of the whole group.
 */
function findTargetSections(
  variables: readonly Pick<ThemeVariable, 'group' | 'target' | 'category'>[],
): (string | null)[] {
  const sizes = new Map<string, Map<string, number>>();
  const groupCategories = new Set<string>();
  for (const { group, target, category } of variables) {
    if (target === null) {
      groupCategories.add(`${group}\n${category}`);
    } else {
      const counts = sizes.get(group) ?? new Map<string, number>();
      sizes.set(group, counts.set(target, (counts.get(target) ?? 0) + 1));
    }
  }
  return variables.map(({ group, target, category }) => {
    if (target === null) {
      return null;
    }
    let section: string | null = null;
    for (const [candidate, size] of sizes.get(group) ?? []) {
      if (size < MIN_TARGET_SIZE) {
        continue;
      }
      if (candidate === target) {
        return target;
      }
      if (
        target.startsWith(`${candidate}-`) &&
        candidate.length > (section?.length ?? 0)
      ) {
        section = candidate;
      }
    }
    if (section !== null || groupCategories.has(`${group}\n${category}`)) {
      return section;
    }
    return target;
  });
}

function toVariable(path: string[], raw: RawVariable): ThemeVariableBase {
  const defaults: ThemeVariableDefault[] =
    typeof raw._define === 'string'
      ? [{ value: raw._define }]
      : (raw._define ?? []);
  const isUnconditional = (d: ThemeVariableDefault) => !d.selector && !d.media;
  return {
    name: getThemeVariableName(path),
    path,
    group: path[0],
    key: path.slice(1).join('-'),
    syntax: raw._syntax,
    properties: [raw._property ?? []].flat(),
    defaultValue: defaults.find(isUnconditional)?.value,
    conditionalDefaults: defaults.filter((d) => !isUnconditional(d)),
  };
}

export function flattenThemeVariables(tree: unknown): ThemeVariable[] {
  const bases: ThemeVariableBase[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (isRawVariable(node)) {
      bases.push(toVariable(path, node));
    } else if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) {
        walk(child, [...path, key]);
      }
    }
  };
  walk(tree, []);

  const splits = splitKeys(bases);
  const variables = bases.map((base, index) => ({
    ...base,
    target: splits[index].target,
    propertyKey: splits[index].propertyKey,
    category: categorize(splits[index], base.properties),
  }));
  const sections = findTargetSections(variables);
  return variables.map((variable, index): ThemeVariable => {
    const section = sections[index];
    return {
      ...variable,
      subgroup:
        section === null
          ? { kind: 'category', id: variable.category }
          : { kind: 'target', id: section },
    };
  });
}

const categoryRank = (category: ThemeVariableCategory) =>
  THEME_VARIABLE_CATEGORIES.indexOf(category);

const subgroupRank = (subgroup: ThemeVariableSubgroupRef) =>
  subgroup.kind === 'category'
    ? categoryRank(subgroup.id)
    : THEME_VARIABLE_CATEGORIES.length;

function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return a.length - b.length;
}

export function groupThemeVariables(
  variables: readonly ThemeVariable[],
): ThemeVariableGroup[] {
  const groups = new Map<string, ThemeVariableGroup>();
  for (const variable of variables) {
    const groupId = getSettingsGroupId(variable.group, variable.subgroup);
    let group = groups.get(groupId);
    if (!group) {
      group = { id: groupId, variables: [], subgroups: [] };
      groups.set(groupId, group);
    }
    group.variables.push(variable);
    const { kind, id } = variable.subgroup;
    let subgroup = group.subgroups.find(
      (s) => s.group === variable.group && s.kind === kind && s.id === id,
    );
    if (!subgroup) {
      subgroup = {
        ...variable.subgroup,
        group: variable.group,
        module: getForeignModule(groupId, variable.group),
        variables: [],
      };
      group.subgroups.push(subgroup);
    }
    subgroup.variables.push(variable);
  }
  for (const group of groups.values()) {
    const rankOf = (subgroup: ThemeVariableSubgroup) => [
      ...getSourceRank(group.id, subgroup.group, subgroup),
      subgroupRank(subgroup),
    ];
    group.subgroups.sort((a, b) => compareRanks(rankOf(a), rankOf(b)));
    for (const subgroup of group.subgroups) {
      if (subgroup.kind === 'target') {
        subgroup.variables.sort(
          (a, b) => categoryRank(a.category) - categoryRank(b.category),
        );
      }
    }
  }
  return [...groups.values()].sort(
    (a, b) => getSettingsGroupRank(a.id) - getSettingsGroupRank(b.id),
  );
}

export function buildThemeVariableSchema(tree: unknown): ThemeVariableSchema {
  const variables = flattenThemeVariables(tree);
  return {
    variables,
    groups: groupThemeVariables(variables),
    byName: new Map(variables.map((variable) => [variable.name, variable])),
  };
}

let schema: Promise<ThemeVariableSchema> | undefined;

/**
 * Loads the variables that `@vivliostyle/theme-base` documents. The JSON is
 * imported dynamically to keep its ~250 KB out of the main chunk.
 */
export function loadThemeVariableSchema(): Promise<ThemeVariableSchema> {
  schema ??= import('@vivliostyle/theme-base/css-variables.json').then(
    (module) => buildThemeVariableSchema(module.default),
    (error: unknown) => {
      // Let a later call retry a chunk that failed to load.
      schema = undefined;
      throw error;
    },
  );
  return schema;
}
