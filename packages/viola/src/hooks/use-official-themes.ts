import { getOfficialThemeTitle } from '../libs/official-theme-title';
import { fetchOfficialThemes } from '../libs/theme-site';
import { Theme } from '../stores/proxies/theme';
import { usePromiseState } from './use-promise-state';

export interface OfficialThemeEntry {
  name: string;
  title: string;
}

const builtinThemes = (): OfficialThemeEntry[] =>
  Object.entries(Theme.officialThemes).map(([name, { title }]) => ({
    name,
    title: getOfficialThemeTitle(name, title),
  }));

let themesPromise: Promise<OfficialThemeEntry[]> | undefined;

/**
 * The official themes listed by theme.vivliostyle.org, or the built-in list
 * while it loads or when the catalog cannot be reached.
 */
export function useOfficialThemes(): OfficialThemeEntry[] {
  themesPromise ??= fetchOfficialThemes().then(
    (themes) =>
      themes.map((theme) => ({
        name: theme.name,
        title: getOfficialThemeTitle(theme.name, theme.title),
      })),
    () => builtinThemes(),
  );
  const { value } = usePromiseState(themesPromise);
  return value ?? builtinThemes();
}
