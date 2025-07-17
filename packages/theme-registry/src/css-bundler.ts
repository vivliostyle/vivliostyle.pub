import init, * as lightningCss from 'lightningcss-wasm';
import wasmUrl from 'lightningcss-wasm/lightningcss_node.wasm?url';

import { contentCache, directorySourceMap, fileMap } from './store';
import type { PackageJson } from './type';
import { validate as validatePackageName } from './validate-npm-package-name';

export function locateDefaultThemeFile({
  packageJson,
}: {
  packageJson: PackageJson;
}): string {
  // biome-ignore lint/suspicious/noExplicitAny: FIXME
  const pkg = packageJson as any;
  const maybeStyle = pkg.vivliostyle?.theme?.style ?? pkg.style ?? pkg.main;
  if (typeof maybeStyle !== 'string' || !maybeStyle.endsWith('.css')) {
    throw new Error(
      `Could not find a style file for the theme: ${packageJson.name}. Please ensure this package satisfies a \`vivliostyle.theme.style\` property.`,
    );
  }
  return maybeStyle;
}

export function locateThemeFileFromImportPath({
  packageJson,
  importPath,
  fileList,
}: {
  packageJson: PackageJson;
  importPath: string;
  fileList: string[];
}): string {
  // biome-ignore lint/suspicious/noExplicitAny: FIXME
  const pkg = packageJson as any;
  if (pkg.exports) {
    if (typeof pkg.exports !== 'object') {
      throw new Error(
        `The package ${packageJson.name} has an invalid exports field. It should be an object or a function.`,
      );
    }
    const exportPath = pkg.exports[importPath];
    if (typeof exportPath === 'string') {
      return exportPath;
    }
    if (exportPath && typeof exportPath === 'object' && exportPath.style) {
      return exportPath.style;
    }
    throw new Error(
      `The package ${packageJson.name} does not export the path ${importPath}.`,
    );
  }
  if (fileList.includes(pkg.importPath)) {
    return pkg.style;
  }
  throw new Error(
    `The package ${packageJson.name} does not have a style file for the import path ${importPath}.`,
  );
}

function resolve(specifier: string, from: string): string {
  // Resolve a relative path
  if (specifier.startsWith('.')) {
    let url = new URL(from, 'file:///');
    url = new URL(specifier, url);
    const filename = url.pathname.replace(/^\//, '');
    if (!fileMap.has(filename)) {
      throw new Error(`File not found: ${specifier} from ${from}`);
    }
    return filename;
  }

  // Resolve a package name
  const matched = specifier.match(
    /^(?<packageName>(?:@([^/]+?)[/])?([^/]+?))(\/(?<importPath>.*[^/]))?$/,
  );
  if (matched?.groups && validatePackageName(matched.groups.packageName)) {
    const { packageName, importPath } = matched.groups;
    const packageRoot = `node_modules/${packageName}`;
    const packageJsonBuffer = fileMap.get(
      `${packageRoot}/package.json`,
    )?.fileData;
    const packageJson =
      packageJsonBuffer &&
      JSON.parse(new TextDecoder().decode(packageJsonBuffer));
    const source = directorySourceMap.get(packageRoot);
    const fileList = source && contentCache.get(source)?.map((f) => f.name);
    if (packageJson && fileList) {
      return [
        packageRoot,
        importPath
          ? locateThemeFileFromImportPath({ packageJson, importPath, fileList })
          : locateDefaultThemeFile({ packageJson }),
      ].join('/');
    }

    // Optimistically resolve the file, even if the specifier doesn't start with a dot.
    let url = new URL(from, 'file:///');
    url = new URL(specifier, url);
    const filename = url.pathname.replace(/^\//, '');
    if (fileMap.has(filename)) {
      return filename;
    }
    throw new Error(`Package ${packageName} not found in theme registry.`);
  }
  throw new Error(`Invalid specifier: ${specifier}`);
}

let initialized = false;
async function initLightningCss() {
  if (initialized) {
    return;
  }
  initialized = true;
  return await init(wasmUrl);
}

export async function bundleCss(source: string) {
  await initLightningCss();

  return await lightningCss.bundleAsync({
    filename: 'index.css',
    minify: true,
    resolver: {
      resolve,
      read: async (file) => {
        if (file === 'index.css') {
          return source;
        }
        const fileData = fileMap.get(file);
        if (!fileData) {
          throw new Error(`File not found: ${file}`);
        }
        return (
          new TextDecoder()
            .decode(fileData.fileData)
            // Replace them with a dummy rule since some @page rules throw a parse error in LightningCSS
            .replace(/@page/g, '@-page')
            // Avoid the default resolver until LightningCSS supports external @import rules
            // https://github.com/parcel-bundler/lightningcss/issues/479
            .replace(
              /@import\s+(url\(\s*("[^"]*"|'[^']*')\s*\)|("[^"]*"|'[^']*'))/g,
              '@-import $1',
            )
        );
      },
    },
    visitor: {
      Rule: {
        unknown(rule: lightningCss.UnknownAtRule) {
          if (rule.name === '-import') {
            const firstToken = rule.prelude[0];
            return {
              type: 'import',
              value: {
                loc: rule.loc,
                url:
                  firstToken.type === 'url'
                    ? firstToken.value.url
                    : (firstToken.value as string),
              },
            } satisfies lightningCss.ReturnedRule;
          }
          // Suppress output of unknown rules
          return [];
        },
      },
    },
  });
}
