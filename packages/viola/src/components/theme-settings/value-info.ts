import {
  getDescriptorUnits,
  type ValueDescriptor,
  type ValueType,
} from '../../libs/theme-variables';

// Locale-less, so that MDN redirects to the reader's language.
const MDN_CSS_REFERENCE =
  'https://developer.mozilla.org/docs/Web/CSS/Reference';

// theme-base lists these `@page` descriptors among the properties.
const PAGE_DESCRIPTORS = new Set(['size', 'bleed', 'marks']);

// Paged-media features that Vivliostyle implements and MDN does not document.
const UNDOCUMENTED = new Set(['bleed', 'marks', 'string-set', 'text-spacing']);

// Vendor-prefixed and custom properties have no MDN page of their own.
const STANDARD_NAME = /^[a-z]+(?:-[a-z]+)*$/;

export interface CssReference {
  name: string;
  /** At-rule that `name` is a descriptor of. */
  atRule: '@page' | null;
  /** `null` when MDN has no page for it. */
  url: string | null;
}

export function getCssReference(name: string): CssReference {
  const atRule = PAGE_DESCRIPTORS.has(name) ? '@page' : null;
  if (UNDOCUMENTED.has(name) || !STANDARD_NAME.test(name)) {
    return { name, atRule, url: null };
  }
  const path = atRule ? `At-rules/${atRule}/${name}` : `Properties/${name}`;
  return { name, atRule, url: `${MDN_CSS_REFERENCE}/${path}` };
}

/** `null` for `font-family`, which hints at an input and is no data type. */
export function getDataTypeUrl(type: ValueType): string | null {
  if (type === 'font-family') {
    return null;
  }
  const slug = type === 'color' ? 'color_value' : type;
  return `${MDN_CSS_REFERENCE}/Values/${slug}`;
}

/** Units of the dimension types; a unitless number is told by its type. */
export function getValueUnits(descriptor: ValueDescriptor): string[] {
  return getDescriptorUnits(descriptor).filter((unit) => unit !== '');
}
