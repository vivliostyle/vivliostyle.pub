import {
  type ValueDescriptor,
  validateValue,
} from '../../libs/theme-variables';
import { findNumericTokens } from './number-stepper';

/**
 * The unit a bare number gets: the first one of `units` in use at the top
 * level of a source, so that typing `12` over `10pt` stays in points.
 */
export function getDefaultUnit(
  units: readonly string[],
  sources: readonly (string | undefined)[],
): string {
  for (const source of sources) {
    for (const token of findNumericTokens(source ?? '')) {
      const unit =
        token.depth === 0 && token.unit !== ''
          ? units.find((u) => u.toLowerCase() === token.unit.toLowerCase())
          : undefined;
      if (unit) {
        return unit;
      }
    }
  }
  return units.find((unit) => unit !== '') ?? '';
}

const isBoundary = (c: string | undefined) =>
  c === undefined || /[\s,/]/.test(c);

/**
 * Gives `unit` to each top-level bare number that would otherwise be
 * rejected as `missing-unit`. Checked as if the descriptor were strict, since
 * a universal one accepts `12` where its hinted property (`margin`) does not.
 */
export function completeUnits(
  text: string,
  descriptor: ValueDescriptor,
  unit: string,
): string {
  if (unit === '') {
    return text;
  }
  const strict = { ...descriptor, universal: false };
  let completed = '';
  let last = 0;
  for (const token of findNumericTokens(text)) {
    const validation =
      token.depth === 0 &&
      token.unit === '' &&
      isBoundary(text[token.start - 1]) &&
      isBoundary(text[token.end])
        ? validateValue(strict, token.number)
        : null;
    if (validation?.valid === false && validation.reason === 'missing-unit') {
      completed += text.slice(last, token.end) + unit;
      last = token.end;
    }
  }
  return completed + text.slice(last);
}
