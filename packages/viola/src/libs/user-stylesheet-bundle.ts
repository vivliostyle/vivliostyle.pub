import { classifyCssImport, extractCssImportSpecifiers } from './css-imports';

export interface StylesheetBundleError {
  kind: 'import' | 'syntax';
  /** The import specifier at fault, when known. */
  target?: string;
  message: string;
}

export interface StylesheetBundleResult {
  /** `undefined` when no stylesheet has an `@import`, so the raw text applies as is. */
  css: string | undefined;
  error?: StylesheetBundleError;
}

export interface StylesheetBundleCache {
  lastInstallKey: string;
  installErrors: Map<string, string>;
  lastGood: Map<string, string>;
}

export const createStylesheetBundleCache = (): StylesheetBundleCache => ({
  lastInstallKey: '',
  installErrors: new Map(),
  lastGood: new Map(),
});

export interface StylesheetBundleContext {
  isProjectFile: (path: string) => boolean;
  readProjectFile: (path: string) => Promise<string | undefined>;
  cache: StylesheetBundleCache;
  isStale: () => boolean;
}

const MAX_PROJECT_FILES = 64;
const PROJECT_DIR = 'project';
const IMPORT_ERROR_PATTERN =
  /not found|Invalid specifier|does not (?:export|have)|escapes|Could not find|Unsupported specifier|Cannot find package|Failed to fetch|Incorrect shasum/i;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function collectImports(
  sheets: readonly { path: string; css: string }[],
  { isProjectFile, readProjectFile }: StylesheetBundleContext,
) {
  const files = new Map(sheets.map((it) => [it.path, it.css]));
  const packages = new Map<string, string>();
  let hasImport = false;
  const queue = [...files.keys()];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    for (const specifier of extractCssImportSpecifiers(files.get(path) ?? '')) {
      hasImport = true;
      const target = classifyCssImport(specifier, path, isProjectFile);
      if (target?.kind === 'package') {
        const known = packages.get(target.packageName);
        if (!known || (!known.includes('@', 1) && target.installSpecifier)) {
          packages.set(target.packageName, target.installSpecifier);
        }
      } else if (
        target?.kind === 'file' &&
        !files.has(target.path) &&
        files.size < MAX_PROJECT_FILES
      ) {
        const css = await readProjectFile(target.path).catch(() => undefined);
        if (css !== undefined) {
          files.set(target.path, css);
          queue.push(target.path);
        }
      }
    }
  }
  return { files, packages, hasImport };
}

/**
 * Never throws for bad user input: a sheet that cannot be bundled falls back
 * to its last good bundle, or to its raw text, and the first problem is
 * reported in `error`. Returns `undefined` when `isStale()` turned true.
 */
export async function bundleUserStylesheets(
  sheets: readonly { path: string; css: string }[],
  context: StylesheetBundleContext,
): Promise<StylesheetBundleResult | undefined> {
  const { cache, isStale } = context;
  const { files, packages, hasImport } = await collectImports(sheets, context);
  if (!hasImport) {
    cache.lastGood.clear();
    return { css: undefined };
  }
  if (isStale()) {
    return;
  }

  const {
    bundleCss,
    buildTreeFromRegistry,
    fetchPackageContent,
    isPackageInstalled,
  } = await import('@v/theme-registry');

  const missing = [...packages].filter(([name]) => !isPackageInstalled(name));
  const installKey = missing
    .map(([, spec]) => spec)
    .sort()
    .join('\n');
  if (installKey !== cache.lastInstallKey) {
    const errors = new Map<string, string>();
    await Promise.all(
      missing.map(async ([, specifier]) => {
        try {
          await fetchPackageContent(await buildTreeFromRegistry(specifier));
        } catch (error) {
          errors.set(specifier, messageOf(error));
        }
      }),
    );
    cache.lastInstallKey = installKey;
    cache.installErrors = errors;
  }
  if (isStale()) {
    return;
  }

  let error: StylesheetBundleError | undefined;
  const [firstInstallError] = cache.installErrors;
  if (firstInstallError) {
    error = {
      kind: 'import',
      target: firstInstallError[0],
      message: firstInstallError[1],
    };
  }

  const virtualFiles = new Map(
    [...files].map(([path, css]) => [`${PROJECT_DIR}/${path}`, css]),
  );
  const parts: string[] = [];
  for (const { path, css } of sheets) {
    try {
      const { code } = await bundleCss(
        `@import ${JSON.stringify(`./${PROJECT_DIR}/${path}`)};`,
        virtualFiles,
      );
      const bundled = new TextDecoder().decode(code);
      cache.lastGood.set(path, bundled);
      parts.push(bundled);
    } catch (e) {
      const message = messageOf(e);
      error ??= {
        kind: IMPORT_ERROR_PATTERN.test(message) ? 'import' : 'syntax',
        message,
      };
      parts.push(cache.lastGood.get(path) ?? css);
    }
    if (isStale()) {
      return;
    }
  }
  return { css: parts.join('\n'), error };
}
