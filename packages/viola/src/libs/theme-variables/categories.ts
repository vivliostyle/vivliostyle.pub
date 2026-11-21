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
