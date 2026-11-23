/// <reference types="vite/client" />
import init, * as lightningCss from 'lightningcss-wasm';
import wasmUrl from 'lightningcss-wasm/lightningcss_node.wasm?url';

import { contentCache, directorySourceMap, fileMap } from './store';
import type { PackageExports, PackageJson } from './type';
import { validate as validatePackageName } from './validate-npm-package-name';

// Same conditions as @vivliostyle/cli, so the editor picks the files the preview does
const exportConditions = new Set(['style', 'default']);

const missingStyleMessage = (packageJson: PackageJson) =>
  `Could not find a style file for the theme: ${packageJson.name}. Please ensure this package satisfies a \`vivliostyle.theme.style\` property.`;

function declaredThemeStyle(packageJson: PackageJson): string | undefined {
  const style = packageJson.vivliostyle?.theme?.style ?? packageJson.style;
  return typeof style === 'string' && style ? style : undefined;
}

function fallbackThemeStyles(packageJson: PackageJson): string[] {
  let exported: string | undefined;
  try {
    exported = resolvePackageExports(packageJson, '.');
  } catch {}
  return [exported, packageJson.main].filter(
    (file): file is string => typeof file === 'string' && file.endsWith('.css'),
  );
}

export function locateDefaultThemeFile({
  packageJson,
}: {
  packageJson: PackageJson;
}): string {
  const style =
    declaredThemeStyle(packageJson) ?? fallbackThemeStyles(packageJson)[0];
  if (!style) {
    throw new Error(missingStyleMessage(packageJson));
  }
  return style;
}

function normalizePath(path: string): string | undefined {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') {
      if (!segments.pop()) {
        return;
      }
    } else if (segment && segment !== '.') {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

function matchExportsKey(
  exportsMap: { [key: string]: PackageExports },
  subpath: string,
): [target: PackageExports, patternMatch?: string] | undefined {
  if (Object.hasOwn(exportsMap, subpath) && !subpath.includes('*')) {
    return [exportsMap[subpath]];
  }
  let bestKey: string | undefined;
  let bestMatch: string | undefined;
  for (const key of Object.keys(exportsMap)) {
    const starIndex = key.indexOf('*');
    if (starIndex === -1 || starIndex !== key.lastIndexOf('*')) {
      continue;
    }
    const base = key.slice(0, starIndex);
    const trailer = key.slice(starIndex + 1);
    if (
      subpath.length < key.length ||
      !subpath.startsWith(base) ||
      !subpath.endsWith(trailer)
    ) {
      continue;
    }
    const bestBaseLength = bestKey?.indexOf('*') ?? -1;
    if (
      bestKey === undefined ||
      starIndex > bestBaseLength ||
      (starIndex === bestBaseLength && key.length > bestKey.length)
    ) {
      bestKey = key;
      bestMatch = subpath.slice(starIndex, subpath.length - trailer.length);
    }
  }
  return bestKey === undefined ? undefined : [exportsMap[bestKey], bestMatch];
}

function resolveExportsTarget(
  target: PackageExports | undefined,
  patternMatch: string | undefined,
): string | null | undefined {
  if (typeof target === 'string') {
    return patternMatch === undefined
      ? target
      : target.replaceAll('*', patternMatch);
  }
  if (target === null || target === undefined) {
    return target;
  }
  const candidates = Array.isArray(target)
    ? target
    : Object.entries(target)
        .filter(([condition]) => exportConditions.has(condition))
        .map(([, value]) => value);
  for (const candidate of candidates) {
    const resolved = resolveExportsTarget(candidate, patternMatch);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return;
}

export function resolvePackageExports(
  packageJson: PackageJson,
  subpath: string,
): string | undefined {
  const { exports } = packageJson;
  if (exports === undefined || exports === null) {
    return;
  }
  const exportsMap =
    typeof exports === 'object' &&
    !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith('.'))
      ? exports
      : { '.': exports };
  if (Object.keys(exportsMap).some((key) => !key.startsWith('.'))) {
    throw new Error(
      `The package ${packageJson.name} has an invalid exports field. Subpath keys and condition keys cannot be mixed.`,
    );
  }
  const [target, patternMatch] = matchExportsKey(exportsMap, subpath) ?? [];
  const resolved = resolveExportsTarget(target, patternMatch);
  if (typeof resolved !== 'string' || !resolved.startsWith('./')) {
    throw new Error(
      `The package ${packageJson.name} does not export the path ${subpath}.`,
    );
  }
  return resolved;
}

export function locateThemeFileFromImportPath({
  packageJson,
  importPath = '',
  fileList,
}: {
  packageJson: PackageJson;
  importPath?: string;
  fileList: string[];
}): string {
  const findFile = (path: string | undefined) => {
    const file = path === undefined ? undefined : normalizePath(path);
    return file && fileList.includes(file) ? file : undefined;
  };

  const subpath = normalizePath(importPath);
  if (subpath === undefined) {
    throw new Error(
      `The path ${importPath} escapes the package directory: ${packageJson.name}`,
    );
  }
  if (!subpath) {
    const declaredStyle = declaredThemeStyle(packageJson);
    if (declaredStyle) {
      const file = findFile(declaredStyle);
      if (!file) {
        throw new Error(
          `Could not find a style file for the theme: ${packageJson.name}. The declared style file does not exist: ${declaredStyle}`,
        );
      }
      return file;
    }
    const file = fallbackThemeStyles(packageJson).map(findFile).find(Boolean);
    if (!file) {
      throw new Error(missingStyleMessage(packageJson));
    }
    return file;
  }

  const exported = resolvePackageExports(packageJson, `./${subpath}`);
  const file = findFile(exported ?? subpath);
  if (!file) {
    throw new Error(
      exported
        ? `The exported path ./${subpath} does not exist in the package ${packageJson.name}: ${exported}`
        : `The package ${packageJson.name} does not have a style file for the import path ${importPath}.`,
    );
  }
  return file;
}

function findPackage(
  packageName: string,
  from: string,
): { packageRoot: string; packageJson: PackageJson } | undefined {
  const segments = from.split('/').slice(0, -1);
  for (let depth = segments.length; depth >= 0; depth--) {
    if (segments[depth - 1] === 'node_modules') {
      continue;
    }
    const packageRoot = [
      ...segments.slice(0, depth),
      'node_modules',
      packageName,
    ].join('/');
    const packageJsonFile = fileMap.get(`${packageRoot}/package.json`);
    if (packageJsonFile) {
      return {
        packageRoot,
        packageJson: JSON.parse(
          new TextDecoder().decode(packageJsonFile.fileData),
        ),
      };
    }
  }
}

function resolve(
  specifier: string,
  from: string,
  virtualFiles?: ReadonlyMap<string, string>,
): string {
  const path = specifier.replace(/[?#].*$/, '');
  const relativeFile = path.startsWith('/')
    ? undefined
    : normalizePath(`${from.slice(0, from.lastIndexOf('/') + 1)}${path}`);
  if (specifier.startsWith('.')) {
    if (relativeFile && virtualFiles?.has(relativeFile)) {
      return relativeFile;
    }
    if (!relativeFile || !fileMap.has(relativeFile)) {
      throw new Error(`File not found: ${specifier} from ${from}`);
    }
    return relativeFile;
  }
  // Like @vivliostyle/cli, a bare specifier is a package only if it doesn't name a sibling stylesheet
  if (
    relativeFile?.endsWith('.css') &&
    (virtualFiles?.has(relativeFile) || fileMap.has(relativeFile))
  ) {
    return relativeFile;
  }

  const matched = path.match(
    /^(?<packageName>@[^/@]+\/[^/@]+|[^@/][^/@]*)(?:@[^/]+)?(?:\/(?<importPath>.*))?$/,
  );
  const { packageName, importPath } = matched?.groups ?? {};
  if (!packageName || !validatePackageName(packageName).validForOldPackages) {
    throw new Error(`Invalid specifier: ${specifier}`);
  }
  const found = findPackage(packageName, from);
  const source = found && directorySourceMap.get(found.packageRoot);
  const fileList = source && contentCache.get(source)?.map((f) => f.name);
  if (!found || !fileList) {
    throw new Error(`Package ${packageName} not found in theme registry.`);
  }
  return [
    found.packageRoot,
    locateThemeFileFromImportPath({
      packageJson: found.packageJson,
      importPath,
      fileList,
    }),
  ].join('/');
}

let initialized = false;
async function initLightningCss() {
  if (initialized) {
    return;
  }
  initialized = true;
  return await init(wasmUrl);
}

// LightningCSS hands a visitor the optional fields it leaves empty as `null`
// but fails to read them back from a rule the visitor returns.
function omitNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(omitNulls) as T;
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, omitNulls(item)]),
  ) as T;
}

/**
 * `virtualFiles` supplies stylesheets that live outside the package store
 * (e.g. a project's own files), keyed by a path relative to the entry.
 */
export async function bundleCss(
  source: string,
  virtualFiles?: ReadonlyMap<string, string>,
) {
  await initLightningCss();

  return await lightningCss.bundleAsync({
    filename: 'index.css',
    minify: true,
    resolver: {
      resolve: (specifier, from) => resolve(specifier, from, virtualFiles),
      read: async (file) => {
        if (file === 'index.css') {
          return source;
        }
        const virtual = virtualFiles?.get(file);
        const fileData = fileMap.get(file);
        if (virtual === undefined && !fileData) {
          throw new Error(`File not found: ${file}`);
        }
        return (
          (virtual ?? new TextDecoder().decode(fileData?.fileData))
            // Replace them with a dummy rule since some @page rules throw a parse error in LightningCSS
            .replace(/@page/g, '@-page')
            // Keep external @import rules out of the bundler until LightningCSS supports them
            // https://github.com/parcel-bundler/lightningcss/issues/479
            .replace(
              /@import\s+(url\(\s*(?:"[^"]*"|'[^']*'|[^)\s]*)\s*\)|"[^"]*"|'[^']*')/g,
              (rule, prelude: string) =>
                /^(?:url\(\s*)?["']?(?:[a-z][a-z\d+.-]*:|\/)/i.test(prelude)
                  ? `@-import ${prelude}`
                  : rule,
            )
        );
      },
    },
    visitor: {
      Rule: {
        unknown(rule: lightningCss.UnknownAtRule) {
          const [firstToken] = rule.prelude;
          if (rule.name === '-import' && firstToken) {
            const url =
              firstToken.type === 'url'
                ? firstToken.value.url
                : firstToken.type === 'token' &&
                    firstToken.value.type === 'string'
                  ? firstToken.value.value
                  : undefined;
            if (url) {
              return {
                type: 'import',
                value: { loc: rule.loc, url },
              } satisfies lightningCss.ReturnedRule;
            }
          }
          // Written back unparsed, as the theme settings read the defaults
          // a theme gives pages from them
          if (rule.name === '-page') {
            return {
              type: 'unknown',
              value: omitNulls({ ...rule, name: 'page' }),
            } satisfies lightningCss.ReturnedRule;
          }
          // Suppress output of unknown rules
          return [];
        },
      },
    },
  });
}
