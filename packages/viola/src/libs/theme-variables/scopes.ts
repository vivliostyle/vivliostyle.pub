export interface ThemeScope {
  id: string;
  /** Header of the rule holding the declarations, e.g. `@page :left`. */
  rule: string;
  /** Media type of the `@media` rule wrapping `rule`, if any. */
  media: 'print' | 'screen' | null;
  /** CSS text identifying the scope, for display. */
  label: string;
  /**
   * Tree groups (`ThemeVariable.group`) whose variables take effect here;
   * `null` means all. A page context only feeds `@page` rules and their
   * margin boxes.
   */
  variableGroups: readonly string[] | null;
}

const PAGE_GROUPS = ['page'] as const;

/**
 * The scopes the GUI can edit, in the order their rules are written to a
 * stylesheet. `root` precedes the `@media` scopes so that the latter win the
 * cascade at equal specificity.
 */
export const THEME_SCOPES = [
  {
    id: 'root',
    rule: ':root',
    media: null,
    label: ':root',
    variableGroups: null,
  },
  {
    id: 'page',
    rule: '@page',
    media: null,
    label: '@page',
    variableGroups: PAGE_GROUPS,
  },
  {
    id: 'page-left',
    rule: '@page :left',
    media: null,
    label: '@page :left',
    variableGroups: PAGE_GROUPS,
  },
  {
    id: 'page-right',
    rule: '@page :right',
    media: null,
    label: '@page :right',
    variableGroups: PAGE_GROUPS,
  },
  {
    id: 'page-first',
    rule: '@page :first',
    media: null,
    label: '@page :first',
    variableGroups: PAGE_GROUPS,
  },
  {
    id: 'print-root',
    rule: ':root',
    media: 'print',
    label: '@media print { :root }',
    variableGroups: null,
  },
  {
    id: 'screen-root',
    rule: ':root',
    media: 'screen',
    label: '@media screen { :root }',
    variableGroups: null,
  },
] as const satisfies readonly ThemeScope[];

export type ThemeScopeId = (typeof THEME_SCOPES)[number]['id'];

export const DEFAULT_THEME_SCOPE: ThemeScopeId = 'root';

export function getThemeScope(id: ThemeScopeId): ThemeScope {
  const scope = THEME_SCOPES.find((s) => s.id === id);
  if (!scope) {
    throw new RangeError(`Unknown theme scope: ${id}`);
  }
  return scope;
}

export function isVariableGroupInScope(
  id: ThemeScopeId,
  group: string,
): boolean {
  const { variableGroups } = getThemeScope(id);
  return variableGroups === null || variableGroups.includes(group);
}
