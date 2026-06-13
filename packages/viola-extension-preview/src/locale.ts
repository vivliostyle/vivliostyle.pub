import {
  baseLocale,
  isLocale,
  type Locale,
} from './generated/paraglide/runtime';

// The active locale crosses the Comlink boundary as a plain string, so narrow
// it to a paraglide Locale.
export function toLocale(locale: string): Locale {
  return isLocale(locale) ? locale : baseLocale;
}
