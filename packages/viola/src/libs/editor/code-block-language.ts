/**
 * Where the language sits in a code block's info string: the first word, up
 * to VFM's `:title` if it has one.
 */
export function languageRange(infoString: string): {
  from: number;
  to: number;
} {
  const from = infoString.match(/^[ \t]*/)?.[0].length ?? 0;
  const language = infoString.slice(from).match(/^[^ \t:]*/)?.[0] ?? '';
  return { from, to: from + language.length };
}

/** Swaps the language for another, leaving the rest of the string alone. */
export function replaceLanguage(
  infoString: string,
  language: string,
): { infoString: string; caret: number } {
  const { from, to } = languageRange(infoString);
  return {
    infoString: infoString.slice(0, from) + language + infoString.slice(to),
    caret: from + language.length,
  };
}

/**
 * Languages starting with what is typed before the caret, while the caret is
 * in the language. Nothing typed yet lists every language only when asked to.
 */
export function suggestLanguages(
  languages: readonly string[],
  infoString: string,
  caret: number,
  { browse = false } = {},
): string[] {
  const { from, to } = languageRange(infoString);
  if (caret < from || caret > to) {
    return [];
  }
  const prefix = infoString.slice(from, caret).toLowerCase();
  if (!prefix && !browse) {
    return [];
  }
  const matches = languages.filter((language) => language.startsWith(prefix));
  return matches.length === 1 && matches[0] === infoString.slice(from, to)
    ? []
    : matches;
}
