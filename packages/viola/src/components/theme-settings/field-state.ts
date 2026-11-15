import { joinDimension, splitDimension } from '../../libs/theme-variables';

/**
 * What the combined number + unit/keyword field shows. `custom` falls back to
 * free text, so a value the structured controls cannot express (`var()`,
 * `calc()`, several components) stays editable.
 */
export type FieldView =
  | { kind: 'empty' }
  | { kind: 'dimension'; number: string; unit: string }
  | { kind: 'keyword'; keyword: string }
  | { kind: 'custom' };

/** A choice in the unit/keyword select that the CSS does not reflect yet. */
export type FieldOverride =
  | null
  | { kind: 'custom' }
  | { kind: 'dimension'; unit: string };

export type FieldOption =
  | { kind: 'default' }
  | { kind: 'unit'; unit: string }
  | { kind: 'keyword'; keyword: string }
  | { kind: 'custom' };

export interface FieldShape {
  keywords: readonly string[];
  /** `''` stands for a unitless number. */
  units: readonly string[];
}

export function parseFieldValue(
  value: string,
  { keywords, units }: FieldShape,
): FieldView {
  const text = value.trim();
  if (text === '') {
    return { kind: 'empty' };
  }
  const keyword = keywords.find((k) => k.toLowerCase() === text.toLowerCase());
  if (keyword) {
    return { kind: 'keyword', keyword };
  }
  const dimension = units.length > 0 ? splitDimension(text) : null;
  if (dimension) {
    const unit = units.find(
      (u) => u.toLowerCase() === dimension.unit.toLowerCase(),
    );
    if (unit !== undefined) {
      return { kind: 'dimension', number: String(dimension.number), unit };
    }
    // A unitless zero is a valid length; show it with the first unit rather
    // than as custom text, since any unit means the same.
    if (dimension.unit === '' && dimension.number === 0) {
      return { kind: 'dimension', number: '0', unit: units[0] };
    }
  }
  return { kind: 'custom' };
}

export function getDefaultUnit(
  shape: FieldShape,
  defaultValue: string | undefined,
): string {
  const parsed = defaultValue ? parseFieldValue(defaultValue, shape) : null;
  return parsed?.kind === 'dimension' ? parsed.unit : (shape.units[0] ?? '');
}

export function resolveFieldView(
  value: string,
  override: FieldOverride,
  shape: FieldShape,
  defaultUnit: string,
): FieldView {
  const parsed = parseFieldValue(value, shape);
  if (override?.kind === 'custom') {
    return { kind: 'custom' };
  }
  if (parsed.kind === 'dimension') {
    return parsed;
  }
  if (override?.kind === 'dimension') {
    return { kind: 'dimension', number: '', unit: override.unit };
  }
  if (parsed.kind === 'empty' && shape.units.length > 0) {
    return { kind: 'dimension', number: '', unit: defaultUnit };
  }
  return parsed;
}

export function encodeOption(option: FieldOption): string {
  switch (option.kind) {
    case 'unit':
      return `unit:${option.unit}`;
    case 'keyword':
      return `keyword:${option.keyword}`;
    default:
      return option.kind;
  }
}

export function decodeOption(encoded: string): FieldOption {
  if (encoded.startsWith('unit:')) {
    return { kind: 'unit', unit: encoded.slice('unit:'.length) };
  }
  if (encoded.startsWith('keyword:')) {
    return { kind: 'keyword', keyword: encoded.slice('keyword:'.length) };
  }
  return encoded === 'custom' ? { kind: 'custom' } : { kind: 'default' };
}

export function getSelectedOption(view: FieldView): FieldOption {
  switch (view.kind) {
    case 'dimension':
      return { kind: 'unit', unit: view.unit };
    case 'keyword':
      return { kind: 'keyword', keyword: view.keyword };
    case 'custom':
      return { kind: 'custom' };
    default:
      return { kind: 'default' };
  }
}

/** The value to commit for a number typed next to `unit`; empty unsets. */
export function composeDimension(number: string, unit: string): string {
  const text = number.trim();
  if (text === '') {
    return '';
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) && /^[+-]?[\d.]/.test(text)
    ? joinDimension({ number: parsed, unit })
    : `${text}${unit}`;
}
