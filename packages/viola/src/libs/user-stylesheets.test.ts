import { describe, expect, it } from 'vitest';

import {
  DEFAULT_USER_STYLESHEET_PATH,
  resolveUserStylesheetPaths,
  toConfigThemeEntries,
} from './user-stylesheets';

const filesOf =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe('resolveUserStylesheetPaths', () => {
  it('reads the legacy single-stylesheet config', () => {
    expect(
      resolveUserStylesheetPaths(
        ['@vivliostyle/theme-base', './style.css'],
        filesOf('style.css'),
      ),
    ).toEqual(['style.css']);
  });

  it('keeps cascade order and skips packages and URLs', () => {
    expect(
      resolveUserStylesheetPaths(
        [
          '@vivliostyle/theme-base',
          './a.css',
          { specifier: 'styles/b.css' },
          'https://example.com/c.css',
          '@vivliostyle/theme-techbook@1.0.0',
          './a.css',
        ],
        filesOf('a.css', 'styles/b.css', 'c.css'),
      ),
    ).toEqual(['a.css', 'styles/b.css']);
  });

  it('accepts a single string or object theme', () => {
    expect(
      resolveUserStylesheetPaths('./custom.css', filesOf('custom.css')),
    ).toEqual(['custom.css']);
    expect(
      resolveUserStylesheetPaths(
        { specifier: './custom.css' },
        filesOf('custom.css'),
      ),
    ).toEqual(['custom.css']);
  });

  it('ignores listed stylesheets that are missing or outside the project', () => {
    expect(
      resolveUserStylesheetPaths(
        ['./missing.css', '../outside.css', '/abs.css'],
        filesOf('outside.css', 'abs.css'),
      ),
    ).toEqual([DEFAULT_USER_STYLESHEET_PATH]);
  });

  it('falls back to the default stylesheet when none is configured', () => {
    expect(resolveUserStylesheetPaths(undefined, filesOf())).toEqual([
      DEFAULT_USER_STYLESHEET_PATH,
    ]);
    expect(
      resolveUserStylesheetPaths('@vivliostyle/theme-base', filesOf()),
    ).toEqual([DEFAULT_USER_STYLESHEET_PATH]);
  });
});

describe('toConfigThemeEntries', () => {
  it('lists the theme package before the user stylesheets', () => {
    expect(
      toConfigThemeEntries('@vivliostyle/theme-base', ['style.css', 'a/b.css']),
    ).toEqual(['@vivliostyle/theme-base', './style.css', './a/b.css']);
  });

  it('round-trips through resolveUserStylesheetPaths', () => {
    const paths = ['b.css', 'style.css', 'nested/c.css'];
    expect(
      resolveUserStylesheetPaths(
        toConfigThemeEntries('@vivliostyle/theme-base', paths),
        filesOf(...paths),
      ),
    ).toEqual(paths);
  });
});
