import { collapseSeparators } from './config';
import type { EditorMenuCommand, ResolvedMenuEntry } from './types';

// NFKC folds full-width alphanumerics typed through an IME (e.g. `ｈ１`) into
// their ASCII forms.
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

export function matchesQuery(
  command: EditorMenuCommand,
  query: string,
): boolean {
  const needle = normalize(query);
  if (!needle) {
    return true;
  }
  return [command.label(), ...(command.keywords?.() ?? [])].some((text) =>
    normalize(text).includes(needle),
  );
}

export function filterMenuEntries(
  entries: readonly ResolvedMenuEntry[],
  query: string,
): ResolvedMenuEntry[] {
  if (!query) {
    return [...entries];
  }
  return collapseSeparators(
    entries.flatMap((entry): ResolvedMenuEntry[] => {
      switch (entry.type) {
        case 'separator':
          return [entry];
        case 'command':
          return matchesQuery(entry.command, query) ? [entry] : [];
        default: {
          const commands = entry.commands.filter((command) =>
            matchesQuery(command, query),
          );
          return commands.length > 0 ? [{ ...entry, commands }] : [];
        }
      }
    }),
  );
}
