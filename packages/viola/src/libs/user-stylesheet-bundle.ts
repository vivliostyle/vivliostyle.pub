import { classifyCssImport, scanCssImports } from './css-imports';

export interface StylesheetBundleError {
  kind: 'import' | 'syntax';
  /** The import specifier at fault, when known. */
  target?: string;
  message: string;
}

export interface StylesheetBundleResult {
  /** `undefined` when no sheet imports a package or project file, so the raw text applies as is. */
  css: string | undefined;
  error?: StylesheetBundleError;
}

export interface StylesheetRegistry {
  bundleCss: (
    source: string,
    files: ReadonlyMap<string, string>,
  ) => Promise<string>;
  installPackage: (specifier: string) => Promise<void>;
  isPackageInstalled: (packageName: string) => boolean;
  isValidPackageName: (packageName: string) => boolean;
}

export async function loadStylesheetRegistry(): Promise<StylesheetRegistry> {
  const registry = await import('@v/theme-registry');
  return {
    bundleCss: async (source, files) =>
      new TextDecoder().decode((await registry.bundleCss(source, files)).code),
    installPackage: async (specifier) => {
      await registry.fetchPackageContent(
        await registry.buildTreeFromRegistry(specifier),
      );
    },
    isPackageInstalled: registry.isPackageInstalled,
    isValidPackageName: registry.isValidPackageName,
  };
}

export interface StylesheetBundleCache {
  inflight: Map<string, Promise<void>>;
  failures: Map<string, { message: string; at: number }>;
  /** Bundler output by bundler input, valid only while the installed packages stay the same. */
  inlined: Map<string, Promise<string>>;
}

export const createStylesheetBundleCache = (): StylesheetBundleCache => ({
  inflight: new Map(),
  failures: new Map(),
  inlined: new Map(),
});

/** Call whenever a package is (re)installed, as the bundler resolves against the installed set. */
export function resetInlinedImports(cache: StylesheetBundleCache) {
  // Replaced rather than cleared, so that bundles still running land in the old map
  cache.inlined = new Map();
}

export interface StylesheetBundleContext {
  isProjectFile: (path: string) => boolean;
  readProjectFile: (path: string) => Promise<string | undefined>;
  cache: StylesheetBundleCache;
  isStale: () => boolean;
  registry?: () => Promise<StylesheetRegistry>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_PROJECT_FILES = 64;
const MAX_INLINED_ENTRIES = 32;
const PROJECT_DIR = 'project';
// Spares the registry from half-typed names while the user is still typing
export const INSTALL_IDLE_MS = 800;
// Failures are retried after this, since a network error is indistinguishable from a 404
export const INSTALL_FAILURE_TTL_MS = 15_000;
const IMPORT_ERROR_PATTERN =
  /not found|Invalid specifier|Invalid package name|does not (?:export|have)|escapes|Could not find|Unsupported specifier|Cannot find package|Failed to fetch|Incorrect shasum/i;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type InlinableTarget = Extract<
  NonNullable<ReturnType<typeof classifyCssImport>>,
  { kind: 'package' | 'file' }
>;

interface SheetImport {
  start: number;
  end: number;
  specifier: string;
  target: InlinableTarget;
}

function inlinableImports(
  path: string,
  css: string,
  isProjectFile: (path: string) => boolean,
): SheetImport[] {
  const imports: SheetImport[] = [];
  for (const rule of scanCssImports(css)) {
    const target = classifyCssImport(rule.specifier, path, isProjectFile);
    if (target && (target.kind === 'package' || target.kind === 'file')) {
      imports.push({ ...rule, target });
    }
  }
  return imports;
}

/** Whether any sheet has an `@import` that `bundleUserStylesheets` would inline. */
export function needsStylesheetBundle(
  sheets: readonly { path: string; css: string }[],
  isProjectFile: (path: string) => boolean,
) {
  return sheets.some(
    (it) => inlinableImports(it.path, it.css, isProjectFile).length > 0,
  );
}

async function inline(
  cache: StylesheetBundleCache,
  registry: StylesheetRegistry,
  source: string,
  files: ReadonlyMap<string, string>,
) {
  const memo = cache.inlined;
  const key = JSON.stringify([source, [...files]]);
  let result = memo.get(key);
  if (result) {
    memo.delete(key);
  } else {
    result = registry.bundleCss(source, files);
    // Failures are not kept, as some (e.g. loading the bundler) are transient
    result.catch(() => {
      if (memo.get(key) === result) {
        memo.delete(key);
      }
    });
  }
  memo.set(key, result);
  for (const oldest of memo.keys()) {
    if (memo.size <= MAX_INLINED_ENTRIES) {
      break;
    }
    memo.delete(oldest);
  }
  return await result;
}

async function collectImports(
  sheets: readonly { path: string; css: string }[],
  { isProjectFile, readProjectFile }: StylesheetBundleContext,
) {
  const files = new Map(sheets.map((it) => [it.path, it.css]));
  const packages = new Map<string, string>();
  const needsBundle = needsStylesheetBundle(sheets, isProjectFile);
  const queue = needsBundle ? [...files.keys()] : [];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    for (const { target } of inlinableImports(
      path,
      files.get(path) ?? '',
      isProjectFile,
    )) {
      if (target.kind === 'package') {
        const known = packages.get(target.packageName);
        if (!known || (!known.includes('@', 1) && target.installSpecifier)) {
          packages.set(target.packageName, target.installSpecifier);
        }
      } else if (!files.has(target.path) && files.size < MAX_PROJECT_FILES) {
        const css = await readProjectFile(target.path).catch(() => undefined);
        if (css !== undefined) {
          files.set(target.path, css);
          queue.push(target.path);
        }
      }
    }
  }
  return { files, packages, needsBundle };
}

function removeRanges(css: string, ranges: { start: number; end: number }[]) {
  let result = css;
  for (const { start, end } of [...ranges].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

/**
 * Only the `@import` rules of each sheet go through the bundler. The rest of
 * the sheet is appended as raw text, so a syntax error in it neither blocks
 * the imports nor hides the valid rules around the error.
 *
 * Never throws for bad user input; the first problem is reported in `error`.
 * Returns `undefined` when `isStale()` turned true.
 */
export async function bundleUserStylesheets(
  sheets: readonly { path: string; css: string }[],
  context: StylesheetBundleContext,
): Promise<StylesheetBundleResult | undefined> {
  const {
    cache,
    isStale,
    isProjectFile,
    registry: loadRegistry = loadStylesheetRegistry,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = context;
  const { files, packages, needsBundle } = await collectImports(
    sheets,
    context,
  );
  if (!needsBundle) {
    return { css: undefined };
  }
  if (isStale()) {
    return;
  }
  const registry = await loadRegistry();

  const installErrors = new Map<string, string>();
  const toInstall: string[] = [];
  for (const [name, specifier] of packages) {
    if (registry.isPackageInstalled(name)) {
      continue;
    }
    const failure = cache.failures.get(specifier);
    if (!registry.isValidPackageName(name)) {
      installErrors.set(specifier, `Invalid package name: ${name}`);
    } else if (failure && now() - failure.at < INSTALL_FAILURE_TTL_MS) {
      installErrors.set(specifier, failure.message);
    } else {
      toInstall.push(specifier);
    }
  }
  if (toInstall.some((specifier) => !cache.inflight.has(specifier))) {
    await sleep(INSTALL_IDLE_MS);
    if (isStale()) {
      return;
    }
  }
  await Promise.all(
    toInstall.map(async (specifier) => {
      let promise = cache.inflight.get(specifier);
      if (!promise) {
        promise = registry.installPackage(specifier).then(
          () => {
            cache.failures.delete(specifier);
            resetInlinedImports(cache);
          },
          (error) => {
            cache.failures.set(specifier, {
              message: messageOf(error),
              at: now(),
            });
          },
        );
        cache.inflight.set(specifier, promise);
        promise.finally(() => cache.inflight.delete(specifier));
      }
      await promise;
      const failure = cache.failures.get(specifier);
      if (failure) {
        installErrors.set(specifier, failure.message);
      }
    }),
  );
  if (isStale()) {
    return;
  }

  let error: StylesheetBundleError | undefined;
  const [firstInstallError] = installErrors;
  if (firstInstallError) {
    error = {
      kind: 'import',
      target: firstInstallError[0],
      message: firstInstallError[1],
    };
  }

  const bundleEntry = async (path: string, entryCss: string) => {
    const virtualFiles = new Map(
      [...files].map(([filePath, css]) => [`${PROJECT_DIR}/${filePath}`, css]),
    );
    virtualFiles.set(`${PROJECT_DIR}/${path}`, entryCss);
    return await inline(
      cache,
      registry,
      `@import ${JSON.stringify(`./${PROJECT_DIR}/${path}`)};`,
      virtualFiles,
    );
  };
  const statementOf = (css: string, { start, end }: SheetImport) => {
    const statement = css.slice(start, end).trimEnd();
    return statement.endsWith(';') ? statement : `${statement};`;
  };

  const parts: string[] = [];
  for (const { path, css } of sheets) {
    const imports = inlinableImports(path, css, isProjectFile);
    if (imports.length === 0) {
      parts.push(css);
      continue;
    }
    const statements = imports.map((it) => statementOf(css, it));
    let inlined: string[];
    try {
      inlined = [await bundleEntry(path, statements.join('\n'))];
    } catch {
      inlined = [];
      for (const [index, statement] of statements.entries()) {
        try {
          inlined.push(await bundleEntry(path, statement));
        } catch (e) {
          const message = messageOf(e);
          error ??= {
            kind: IMPORT_ERROR_PATTERN.test(message) ? 'import' : 'syntax',
            target: imports[index].specifier,
            message,
          };
        }
      }
    }
    parts.push([...inlined, removeRanges(css, imports)].join('\n'));
    if (isStale()) {
      return;
    }
  }
  return { css: parts.join('\n'), error };
}
