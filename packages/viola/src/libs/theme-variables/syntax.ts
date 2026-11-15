import type { ThemeVariable } from './schema';

/** Data types of the `@property` syntax that values are checked against. */
export const CSS_DATA_TYPES = [
  'length',
  'percentage',
  'length-percentage',
  'number',
  'integer',
  'angle',
  'time',
  'resolution',
  'color',
  'string',
  'custom-ident',
] as const;

export type CssDataType = (typeof CSS_DATA_TYPES)[number];

/** `font-family` is no CSS data type; it only hints at a font picker. */
export type ValueType = CssDataType | 'font-family';

export type ValueMultiplier = 'space' | 'comma';

export type ValueInputKind =
  | 'color'
  | 'font-family'
  | 'select'
  | 'dimension'
  | 'number'
  | 'text';

export interface ValueDescriptor {
  /**
   * The variable accepts any value: `keywords` and `types` are then only a
   * hint for picking an input, and validation never rejects on them.
   */
  universal: boolean;
  keywords: readonly string[];
  types: readonly ValueType[];
  /** Set when the value is a list, with the separator of its items. */
  multiplier: ValueMultiplier | null;
  /** The input that suits the value best. */
  input: ValueInputKind;
}

type Hint = Pick<ValueDescriptor, 'types'> &
  Partial<Pick<ValueDescriptor, 'keywords' | 'multiplier'>>;

const DIMENSION_TYPES: readonly ValueType[] = [
  'length',
  'percentage',
  'length-percentage',
  'angle',
  'time',
  'resolution',
];

// Limited to the properties behind most `*` variables: `font-family`,
// `margin-*` and `text-indent` alone cover over a third of them.
const PROPERTY_HINTS: readonly (readonly [RegExp, Hint])[] = [
  [/(^|-)color$/, { types: ['color'] }],
  [/^font-family$/, { types: ['font-family'], multiplier: 'comma' }],
  [
    /^margin(-(block|inline))?$/,
    { types: ['length-percentage'], keywords: ['auto'], multiplier: 'space' },
  ],
  [/^(text-indent|.+-width)$/, { types: ['length-percentage'] }],
];

// A variable that feeds no property directly (e.g. `--vs-color-border-alt`)
// still names its role.
const KEY_HINTS: readonly (readonly [RegExp, Hint])[] = [
  [/(^|-)color(-|$)/, { types: ['color'] }],
  [/(^|-)font-family(-|$)/, { types: ['font-family'], multiplier: 'comma' }],
];

function pickInput(
  keywords: readonly string[],
  types: readonly ValueType[],
): ValueInputKind {
  if (types.includes('color')) {
    return 'color';
  }
  if (types.includes('font-family')) {
    return 'font-family';
  }
  if (types.some((type) => DIMENSION_TYPES.includes(type))) {
    return 'dimension';
  }
  if (types.includes('number') || types.includes('integer')) {
    return 'number';
  }
  return keywords.length > 0 && types.length === 0 ? 'select' : 'text';
}

function createDescriptor(universal: boolean, hint?: Hint): ValueDescriptor {
  const keywords = hint?.keywords ?? [];
  const types = hint?.types ?? [];
  return {
    universal,
    keywords,
    types,
    multiplier: hint?.multiplier ?? null,
    input: pickInput(keywords, types),
  };
}

function findHint(
  table: readonly (readonly [RegExp, Hint])[],
  subjects: readonly string[],
): Hint | undefined {
  return table.find(
    ([pattern]) =>
      subjects.length > 0 && subjects.every((s) => pattern.test(s)),
  )?.[1];
}

/**
 * Parses an `@property`-like syntax string. Anything it cannot fully make
 * sense of yields a universal descriptor, so that no value gets rejected on
 * the grounds of a misread syntax.
 */
export function parseSyntax(syntax: string): ValueDescriptor {
  const keywords: string[] = [];
  const types: CssDataType[] = [];
  let multiplier: ValueMultiplier | null = null;
  for (const part of syntax.split('|')) {
    const match = part
      .trim()
      .match(/^(?:<([a-z-]+)>|(-?[a-z_][\w-]*))([+#])?$/i);
    if (!match) {
      return createDescriptor(true);
    }
    const [, type, keyword, mark] = match;
    if (keyword) {
      keywords.push(keyword);
    } else if ((CSS_DATA_TYPES as readonly string[]).includes(type)) {
      types.push(type as CssDataType);
    } else {
      return createDescriptor(true);
    }
    if (mark) {
      multiplier = mark === '#' ? 'comma' : 'space';
    }
  }
  return createDescriptor(false, { keywords, types, multiplier });
}

/**
 * Describes the values a variable takes. For the `*` syntax the descriptor is
 * a best-effort hint derived from the consuming properties.
 */
export function describeVariable(
  variable: Pick<ThemeVariable, 'syntax' | 'properties' | 'key'>,
): ValueDescriptor {
  const descriptor = parseSyntax(variable.syntax);
  if (!descriptor.universal) {
    return descriptor;
  }
  const hint =
    variable.properties.length > 0
      ? findHint(PROPERTY_HINTS, variable.properties)
      : findHint(KEY_HINTS, [variable.key]);
  return createDescriptor(true, hint);
}
