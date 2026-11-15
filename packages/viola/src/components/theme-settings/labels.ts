import type { ThemeVariable } from '../../libs/theme-variables';

// Element names and abbreviations read better in capitals than as words.
const UPPERCASE_WORDS = new Set([
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'rt'],
  ...['ol', 'ul', 'li', 'dl', 'dt', 'dd', 'td', 'th'],
  ...['toc', 'rlh'],
]);

const WORDS: Record<string, string> = {
  mbox: 'margin box',
};

export function humanizeKey(key: string): string {
  const words = key
    .split('-')
    .filter((word) => word !== '')
    .map((word) =>
      UPPERCASE_WORDS.has(word) ? word.toUpperCase() : (WORDS[word] ?? word),
    );
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function getVariableLabel(
  variable: Pick<ThemeVariable, 'key' | 'subgroup'>,
): string {
  const { key, subgroup } = variable;
  const rest =
    subgroup !== null && key.startsWith(`${subgroup}-`)
      ? key.slice(subgroup.length + 1)
      : key;
  return humanizeKey(rest || key);
}
