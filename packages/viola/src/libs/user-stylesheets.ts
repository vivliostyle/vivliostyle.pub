import { normalize } from 'pathe';

export const DEFAULT_USER_STYLESHEET_PATH = 'style.css';

type ThemeEntry = string | { readonly specifier: string };

export type ConfigTheme = ThemeEntry | readonly ThemeEntry[] | undefined;

function toProjectPath(specifier: string): string | undefined {
  if (!specifier.endsWith('.css') || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
    return;
  }
  const path = normalize(specifier);
  if (path.startsWith('/') || path.startsWith('../')) {
    return;
  }
  return path;
}

/**
 * Mirrors how `@vivliostyle/cli` tells a local stylesheet from a package:
 * a `.css` specifier that exists as a file relative to the config is a file
 * theme, anything else is resolved as a package or URL.
 */
export function resolveUserStylesheetPaths(
  theme: ConfigTheme,
  isProjectFile: (path: string) => boolean,
): string[] {
  const entries = theme === undefined ? [] : [theme].flat();
  const paths: string[] = [];
  for (const entry of entries) {
    const path = toProjectPath(
      typeof entry === 'string' ? entry : entry.specifier,
    );
    if (path && isProjectFile(path) && !paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths.length > 0 ? paths : [DEFAULT_USER_STYLESHEET_PATH];
}

export function toConfigThemeEntries(
  packageName: string,
  stylesheetPaths: readonly string[],
): string[] {
  return [packageName, ...stylesheetPaths.map((path) => `./${path}`)];
}
