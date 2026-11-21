import type { ThemeVariableSubgroupRef } from './schema';

export const META_GROUP = '_meta-properties';
export const BASIC_GROUP = '_basic';

interface ThemeSubject {
  id: string;
  /**
   * Targets of the element group it takes, in display order. An element
   * also takes the targets its name leads, as `table` takes `table-cell`.
   */
  elements: readonly string[];
  /** Module groups it takes, in display order. */
  modules: readonly string[];
}

// theme-base splits one subject between the element group and a module, such
// as the styles of `<table>` and the numbering of tables.
const SUBJECTS: readonly ThemeSubject[] = [
  { id: 'body', elements: ['p', 'blockquote', 'hr'], modules: [] },
  {
    id: 'heading',
    elements: ['heading', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    modules: ['section'],
  },
  {
    id: 'list',
    elements: ['lists', 'ol', 'ul', 'li', 'dl', 'dt', 'dd'],
    modules: [],
  },
  {
    id: 'table',
    elements: ['table', 'caption', 'th', 'td'],
    modules: ['table'],
  },
  {
    id: 'figure',
    elements: ['figure', 'figcaption', 'img'],
    modules: ['figure'],
  },
  {
    id: 'code',
    elements: ['pre', 'monospace'],
    modules: ['listing', 'prism'],
  },
  { id: 'math', elements: [], modules: ['math', 'equation'] },
  {
    id: 'inline',
    elements: [
      'anchor',
      'crossref-call',
      'emphasis',
      'bold',
      'big',
      'small',
      'sub',
      'sup',
      'del',
      'cite',
      'ruby',
      'rt',
    ],
    modules: [],
  },
];

// The tree lists modules alphabetically; lead with what a book design starts
// from instead. Elements that no subject takes follow the subjects.
const LEADING_GROUPS = [
  META_GROUP,
  'page',
  ...SUBJECTS.map((subject) => subject.id),
  BASIC_GROUP,
];

interface ElementMatch {
  subject: ThemeSubject;
  index: number;
  exact: boolean;
}

function findElement(target: string): ElementMatch | undefined {
  let match: ElementMatch | undefined;
  let matchLength = 0;
  for (const subject of SUBJECTS) {
    for (const [index, element] of subject.elements.entries()) {
      if (
        (target === element || target.startsWith(`${element}-`)) &&
        element.length > matchLength
      ) {
        match = { subject, index, exact: target === element };
        matchLength = element.length;
      }
    }
  }
  return match;
}

/** Id of the settings group that lists a subgroup of a tree group. */
export function getSettingsGroupId(
  group: string,
  subgroup: ThemeVariableSubgroupRef,
): string {
  if (group === BASIC_GROUP) {
    const element =
      subgroup.kind === 'target' ? findElement(subgroup.id) : undefined;
    return element?.subject.id ?? group;
  }
  return (
    SUBJECTS.find((subject) => subject.modules.includes(group))?.id ?? group
  );
}

/**
 * The module that a subgroup listed under a subject of another name comes
 * from, or `null`. Its parts, such as `call`, would read as the subject's own
 * without it.
 */
export function getForeignModule(
  settingsGroup: string,
  group: string,
): string | null {
  return group !== settingsGroup && group !== BASIC_GROUP ? group : null;
}

/**
 * Orders the subgroups that a settings group takes from several tree groups:
 * elements in the order of the subject, each before the targets it leads,
 * then the modules in turn.
 */
export function getSourceRank(
  settingsGroup: string,
  group: string,
  subgroup: ThemeVariableSubgroupRef,
): number[] {
  const subject = SUBJECTS.find((s) => s.id === settingsGroup);
  if (!subject) {
    return [0];
  }
  if (group === BASIC_GROUP) {
    const element =
      subgroup.kind === 'target' ? findElement(subgroup.id) : undefined;
    return [0, element?.index ?? 0, element?.exact === false ? 1 : 0];
  }
  // A module the subject does not list shares its id; it follows the rest.
  const index = subject.modules.indexOf(group);
  return [1 + (index === -1 ? subject.modules.length : index)];
}

export function getSettingsGroupRank(id: string): number {
  const index = LEADING_GROUPS.indexOf(id);
  return index === -1 ? LEADING_GROUPS.length : index;
}
