import { groupedPropAlias } from 'postcss-variable-theming/preset';

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
  /** Cluster inside the group, or `null` for a variable that stands alone. */
  subgroup: string | null;
  /** Name without the `--vs-` prefix of its group. */
  key: string;
  /**
   * Leading part of `key` naming what the variable styles, like `h1` of
   * `h1-font-size`; `null` for a variable of the group as a whole.
   */
  target: string | null;
  /** `key` without its target, like `font-size` of `h1-font-size`. */
  propertyKey: string;
  /** `@property`-like syntax; an approximation of the consuming properties. */
  syntax: string;
  /** CSS properties the variable ends up in. */
  properties: readonly string[];
  /** Default declared unconditionally on `:root`. */
  defaultValue?: string;
  /** Defaults limited to a selector and/or a media query. */
  conditionalDefaults: readonly ThemeVariableDefault[];
}

export interface ThemeVariableSubgroup {
  id: string;
  variables: ThemeVariable[];
}

export interface ThemeVariableGroup {
  id: string;
  /** Every variable of the group, in source order. */
  variables: ThemeVariable[];
  ungrouped: ThemeVariable[];
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

const META_GROUP = '_meta-properties';
const BASIC_GROUP = '_basic';

// The tree lists modules alphabetically; lead with what a book design starts
// from instead.
const LEADING_GROUPS = [META_GROUP, 'page', BASIC_GROUP];

const MARGIN_BOX =
  /^mbox-(?:top|bottom|left|right)(?:-(?:left|right|top|bottom|center|middle))?(?:-corner)?(?=-)/;

// The aliases theme-base generates variable names with. The `color` entry
// comes from its own build config rather than the preset.
const PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  ...groupedPropAlias,
  color: 'text-color',
};

type ThemeVariableBase = Omit<
  ThemeVariable,
  'target' | 'propertyKey' | 'subgroup'
>;

type KeySplit = Pick<ThemeVariable, 'target' | 'propertyKey'>;

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

function getSubgroupCandidate(group: string, key: string): string {
  if (group === 'page' && key.startsWith('mbox-')) {
    return key.match(MARGIN_BOX)?.[0] ?? 'mbox';
  }
  return key.split('-')[0];
}

/**
 * Splits a key the way theme-base's `@var` blocks generate it: a target, a
 * dash, and the aliased name of the property the variable is used in.
 */
function splitByProperty(
  key: string,
  properties: readonly string[],
): KeySplit | null {
  let match: string | undefined;
  for (const property of properties) {
    const name = PROPERTY_ALIASES[property] ?? property;
    if (
      (key === name || key.endsWith(`-${name}`)) &&
      name.length > (match?.length ?? 0)
    ) {
      match = name;
    }
  }
  if (match === undefined) {
    return null;
  }
  return {
    target: key === match ? null : key.slice(0, -match.length - 1),
    propertyKey: match,
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
  const variables: ThemeVariableBase[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (isRawVariable(node)) {
      variables.push(toVariable(path, node));
    } else if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) {
        walk(child, [...path, key]);
      }
    }
  };
  walk(tree, []);

  const splits = splitKeys(variables);
  const sizes = new Map<string, number>();
  const candidateOf = (v: ThemeVariableBase) =>
    `${v.group}/${getSubgroupCandidate(v.group, v.key)}`;
  for (const variable of variables) {
    const candidate = candidateOf(variable);
    sizes.set(candidate, (sizes.get(candidate) ?? 0) + 1);
  }
  return variables.map((variable, index) => ({
    ...variable,
    ...splits[index],
    subgroup:
      (sizes.get(candidateOf(variable)) ?? 0) > 1
        ? getSubgroupCandidate(variable.group, variable.key)
        : null,
  }));
}

export function groupThemeVariables(
  variables: readonly ThemeVariable[],
): ThemeVariableGroup[] {
  const groups = new Map<string, ThemeVariableGroup>();
  for (const variable of variables) {
    let group = groups.get(variable.group);
    if (!group) {
      group = {
        id: variable.group,
        variables: [],
        ungrouped: [],
        subgroups: [],
      };
      groups.set(variable.group, group);
    }
    group.variables.push(variable);
    if (variable.subgroup === null) {
      group.ungrouped.push(variable);
      continue;
    }
    let subgroup = group.subgroups.find((s) => s.id === variable.subgroup);
    if (!subgroup) {
      subgroup = { id: variable.subgroup, variables: [] };
      group.subgroups.push(subgroup);
    }
    subgroup.variables.push(variable);
  }
  const rank = (id: string) => {
    const index = LEADING_GROUPS.indexOf(id);
    return index === -1 ? LEADING_GROUPS.length : index;
  };
  return [...groups.values()].sort((a, b) => rank(a.id) - rank(b.id));
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
