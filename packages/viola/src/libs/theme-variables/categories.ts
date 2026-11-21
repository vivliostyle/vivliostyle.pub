/** What a variable sets, in the order the settings list them. */
export const THEME_VARIABLE_CATEGORIES = [
  'page-setup',
  'font',
  'spacing',
  'alignment',
  'line-breaking',
  'writing-mode',
  'decoration',
  'color',
  'margin',
  'border',
  'layout',
  'visibility',
  'fragmentation',
  'columns',
  'generated-content',
  'other',
] as const;

export type ThemeVariableCategory = (typeof THEME_VARIABLE_CATEGORIES)[number];

// A key covers the property of that name and every property it leads
// (`font` covers `font-size`). `spacing`, `label` and `crossref` are design
// tokens of theme-base, named after what they feed rather than a property.
const CATEGORY_KEYS: Record<
  Exclude<ThemeVariableCategory, 'other'>,
  readonly string[]
> = {
  'page-setup': ['size', 'bleed', 'marks'],
  font: ['font'],
  spacing: [
    'line-height',
    'letter-spacing',
    'word-spacing',
    'text-spacing',
    'tab-size',
  ],
  alignment: [
    'text-align',
    'text-indent',
    'text-justify',
    'vertical-align',
    'ruby',
  ],
  'line-breaking': [
    'line-break',
    'word-break',
    'overflow-wrap',
    'word-wrap',
    'hyphens',
    'hyphenate',
    'hanging-punctuation',
    'white-space',
    'text-wrap',
  ],
  'writing-mode': [
    'writing-mode',
    'text-orientation',
    'text-combine-upright',
    'direction',
    'unicode-bidi',
  ],
  decoration: [
    'text-decoration',
    'text-underline',
    'text-emphasis',
    'text-shadow',
    'text-transform',
  ],
  color: ['color', 'background', 'opacity'],
  margin: ['margin', 'padding', 'gap', 'row-gap', 'spacing'],
  border: ['border', 'outline', 'box-shadow'],
  layout: [
    'width',
    'height',
    'inline-size',
    'block-size',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'min-inline-size',
    'max-inline-size',
    'min-block-size',
    'max-block-size',
    'aspect-ratio',
    'float',
    'clear',
    'position',
    'inset',
    'overflow',
    'align',
    'justify',
    'flex',
    'order',
    'table-layout',
    'caption-side',
    'object',
    'image-resolution',
  ],
  visibility: ['display', 'visibility'],
  fragmentation: ['break', 'widows', 'orphans', 'box-decoration-break'],
  columns: ['columns', 'column'],
  'generated-content': [
    'content',
    'counter',
    'string-set',
    'list-style',
    'quotes',
    'label',
    'crossref',
  ],
};

const CATEGORY_BY_KEY = new Map<string, ThemeVariableCategory>(
  Object.entries(CATEGORY_KEYS).flatMap(([category, keys]) =>
    keys.map((key) => [key, category as ThemeVariableCategory]),
  ),
);

function lookUp(words: readonly string[]): ThemeVariableCategory | undefined {
  for (let end = words.length; end > 0; end--) {
    const category = CATEGORY_BY_KEY.get(words.slice(0, end).join('-'));
    if (category) {
      return category;
    }
  }
  return undefined;
}

/** Category of a property, or of a name that starts like one. */
export function getLeadingCategory(
  name: string,
): ThemeVariableCategory | undefined {
  return lookUp(name.split('-'));
}

/** Category of a name that ends like a property, such as `inside-content`. */
export function getTrailingCategory(
  name: string,
): ThemeVariableCategory | undefined {
  const words = name.split('-');
  for (let start = 1; start < words.length; start++) {
    const category = lookUp(words.slice(start));
    if (category) {
      return category;
    }
  }
  return undefined;
}

// The order a designer reaches for them in, which the source order of the
// keys, being alphabetical, does not follow.
const PROPERTY_ORDER = [
  'size',
  'marks',
  'bleed',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'font-variant-numeric',
  'font-variant-ligatures',
  'font-feature-settings',
  'font-variation-settings',
  'font-kerning',
  'font-synthesis',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-spacing',
  'tab-size',
  'spacing-rlh',
  'spacing-inline-indent',
  'text-align',
  'text-indent',
  'vertical-align',
  'ruby-position',
  'ruby-align',
  'line-break',
  'word-break',
  'overflow-wrap',
  'hyphens',
  'hanging-punctuation',
  'white-space',
  'writing-mode',
  'text-orientation',
  'text-combine-upright',
  'text-decoration',
  'text-underline-position',
  'text-underline-offset',
  'text-transform',
  'text-shadow',
  'text-color',
  'color-foreground',
  'color-background',
  'color-border',
  'background-color',
  'background',
  'background-image',
  'background-position',
  'background-size',
  'margin',
  'padding',
  'gap',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-collapse',
  'width',
  'height',
  'size-inline',
  'max-size-inline',
  'min-size-block',
  'max-size-block',
  'float',
  'clear',
  'position',
  'inset',
  'align-items',
  'flex-direction',
  'order',
  'overflow-x',
  'table-layout',
  'image-resolution',
  'ol-indent-size',
  'display',
  'visibility',
  'cover-page-mbox-visibility',
  'break-before',
  'break-after',
  'break-inside',
  'widows-orphans',
  'widows',
  'orphans',
  'columns',
  'column-gap',
  'column-fill',
  'column-rule-width',
  'column-rule-style',
  'column-rule-color',
  'content',
  'label',
  'suffix',
  'counter-style',
  'counter-delimiter',
  'counter-content',
  'style',
  'string-set',
  'list-style-type',
  'list-style-position',
  'crossref-call-counter-prefix',
  'crossref-marker-counter-prefix',
  'counter-reset',
  'counter-increment',
  'counter',
];

// Sides in logical order, then physical ones clockwise from the top.
const QUALIFIER_ORDER = [
  'block',
  'block-start',
  'block-end',
  'inline',
  'inline-start',
  'inline-end',
  'top',
  'right',
  'bottom',
  'left',
  'inside',
  'outside',
  'outer',
  'row',
  'column',
  'cell',
  'thead-inner',
  'tfoot-inner',
];

/**
 * Sort key of a property key within its category: the property, then the
 * qualifier after it, such as the `block-end` of `border-width-block-end`.
 */
export function getPropertyRank(propertyKey: string): number[] {
  const words = propertyKey.split('-');
  for (let end = words.length; end > 0; end--) {
    const index = PROPERTY_ORDER.indexOf(words.slice(0, end).join('-'));
    if (index === -1) {
      continue;
    }
    const qualifier = words.slice(end).join('-');
    if (qualifier === '') {
      return [index, -1];
    }
    const rank = QUALIFIER_ORDER.indexOf(qualifier);
    return [index, rank === -1 ? QUALIFIER_ORDER.length : rank];
  }
  return [PROPERTY_ORDER.length];
}
