import { CssScanner, isSafeDeclarationValue } from './css-scanner';
import type { ValueDescriptor, ValueType } from './syntax';

export type ValueValidationReason =
  /** Nothing but whitespace. */
  | 'empty'
  /** Unbalanced brackets or quotes, or a stray `;` or `!`. */
  | 'malformed'
  /** A bare number where the value needs a unit. */
  | 'missing-unit'
  /** A unit that none of the accepted types knows. */
  | 'unknown-unit'
  /** Neither an accepted keyword nor a value of an accepted type. */
  | 'not-allowed';

export type ValueValidationResult =
  | { valid: true }
  | { valid: false; reason: ValueValidationReason };

export interface Dimension {
  number: number;
  /** Empty for a unitless number. */
  unit: string;
}

export const CSS_WIDE_KEYWORDS = [
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
] as const;

const LENGTH_UNITS = [
  ...['mm', 'cm', 'in', 'pt', 'pc', 'Q', 'px'],
  ...['em', 'rem', 'ex', 'ch', 'ic', 'lh', 'rlh'],
  ...['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax'],
];

const RARE_LENGTH_UNITS = [
  ...['cap', 'rcap', 'rex', 'rch', 'ric'],
  ...['s', 'l', 'd'].flatMap((size) =>
    ['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax'].map((unit) => size + unit),
  ),
  ...['cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'],
];

const UNITS: Partial<Record<ValueType, readonly string[]>> = {
  length: LENGTH_UNITS,
  percentage: ['%'],
  'length-percentage': [...LENGTH_UNITS, '%'],
  angle: ['deg', 'grad', 'rad', 'turn'],
  time: ['s', 'ms'],
  resolution: ['dpi', 'dpcm', 'dppx', 'x'],
};

const COLOR_FUNCTIONS = new Set(
  'rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark device-cmyk contrast-color'.split(
    ' ',
  ),
);

const NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate
  coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
  darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
  darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
  darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
  dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold
  goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory
  khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
  lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
  lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
  lightsteelblue lightyellow lime limegreen linen magenta maroon
  mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
  mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue
  mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange
  orangered orchid palegoldenrod palegreen paleturquoise palevioletred
  papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
  rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna
  silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
  teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen
  transparent currentcolor
  accentcolor accentcolortext activetext buttonborder buttonface buttontext
  canvas canvastext field fieldtext graytext highlight highlighttext linktext
  mark marktext selecteditem selecteditemtext visitedtext
  activeborder activecaption appworkspace background buttonhighlight
  buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext
  infobackground infotext menu menutext scrollbar threeddarkshadow threedface
  threedhighlight threedlightshadow threedshadow window windowframe windowtext`
    .trim()
    .split(/\s+/),
);

const NUMERIC = /^([+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?)(%|[a-z]*)$/i;
const IDENT = /^(?:--|-?[a-z_\u0080-￿\\])[-\w\u0080-￿\\]*$/i;
const FUNCTION = /^([-\w\u0080-￿\\]+)\(/;

/** Units to offer for a type, the common ones for print first. */
export function getUnits(type: ValueType): readonly string[] {
  return UNITS[type] ?? [];
}

/**
 * Units a value described by `descriptor` can carry, without duplicates. An
 * empty string stands for a unitless number.
 */
export function getDescriptorUnits(descriptor: ValueDescriptor): string[] {
  const units = descriptor.types.flatMap((type) =>
    type === 'number' || type === 'integer' ? [''] : getUnits(type),
  );
  return [...new Set(units)];
}

/** Splits `12.5mm` into number and unit; `null` for anything else. */
export function splitDimension(value: string): Dimension | null {
  const match = value.trim().match(NUMERIC);
  return match ? { number: Number(match[1]), unit: match[2] } : null;
}

export function joinDimension({ number, unit }: Dimension): string {
  // Arithmetic on the number (e.g. a stepper adding 0.1) leaves float noise.
  const rounded = Number.isFinite(number) ? Number(number.toFixed(6)) : 0;
  return `${rounded}${unit}`;
}

function hasUnit(type: ValueType, unit: string): boolean {
  const units =
    type === 'length' || type === 'length-percentage'
      ? [...getUnits(type), ...RARE_LENGTH_UNITS]
      : getUnits(type);
  return units.some((u) => u.toLowerCase() === unit.toLowerCase());
}

function matchesNumeric(
  type: ValueType,
  { number, unit }: Dimension,
  text: string,
): boolean {
  switch (type) {
    case 'number':
      return unit === '';
    case 'integer':
      return unit === '' && /^[+-]?\d+$/.test(text);
    case 'length':
    case 'length-percentage':
    case 'angle':
      // Unitless zero is a valid length, and a valid angle in legacy syntax.
      return unit === '' ? number === 0 : hasUnit(type, unit);
    default:
      return unit !== '' && hasUnit(type, unit);
  }
}

function checkToken(
  { keywords, types }: ValueDescriptor,
  token: string,
): ValueValidationReason | null {
  if (token === ',' || token === '/') {
    return null;
  }
  const fn = token.match(FUNCTION)?.[1].toLowerCase();
  if (fn) {
    // Only color functions have a known result type; `var()`, `calc()`,
    // `env()` and the like can stand for anything.
    return COLOR_FUNCTIONS.has(fn) && !types.includes('color')
      ? 'not-allowed'
      : null;
  }
  if (
    keywords.some((keyword) => keyword.toLowerCase() === token.toLowerCase())
  ) {
    return null;
  }
  if (token.startsWith('"') || token.startsWith("'")) {
    return types.includes('string') ? null : 'not-allowed';
  }
  const dimension = splitDimension(token);
  if (dimension) {
    if (types.some((type) => matchesNumeric(type, dimension, token))) {
      return null;
    }
    const takesUnits = types.some((type) => getUnits(type).length > 0);
    if (!takesUnits) {
      return 'not-allowed';
    }
    return dimension.unit === '' ? 'missing-unit' : 'unknown-unit';
  }
  if (types.includes('color')) {
    if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(token)) {
      return null;
    }
    if (NAMED_COLORS.has(token.toLowerCase())) {
      return null;
    }
  }
  return types.includes('custom-ident') && IDENT.test(token)
    ? null
    : 'not-allowed';
}

/**
 * The schema's syntax flattens the grammar of the consuming property
 * (`oblique 10deg` appears as `oblique | <angle>`), so each component value is
 * checked on its own and their number is not: valid CSS is never rejected.
 */
export function validateValue(
  descriptor: ValueDescriptor,
  value: string,
): ValueValidationResult {
  const text = value.trim();
  if (text === '') {
    return { valid: false, reason: 'empty' };
  }
  if (!isSafeDeclarationValue(text)) {
    return { valid: false, reason: 'malformed' };
  }
  const isWide = (CSS_WIDE_KEYWORDS as readonly string[]).includes(
    text.toLowerCase(),
  );
  const tokens = new CssScanner(text).scanValue();
  if (tokens.length === 0) {
    return { valid: false, reason: 'empty' };
  }
  if (descriptor.universal || isWide) {
    return { valid: true };
  }
  for (const token of tokens) {
    const reason = checkToken(descriptor, token);
    if (reason) {
      return { valid: false, reason };
    }
  }
  return { valid: true };
}
