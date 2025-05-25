import { type TarLocalFile, untar } from '@andrewbranch/untar.js';
import { Gunzip } from 'fflate';
import { invariant } from 'outvariant';
import { satisfies as semverSatisfies } from 'semver';
import { parse } from './../../cli-bundle/src/stubs/rollup/wasm/bindings_wasm_bg.wasm.d';
import { type Result, npa } from './npm-package-arg.js';

export interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  dist?: {
    fileCount: number;
    integrity: string;
    shasum: string;
    signatures: {
      keyid: string;
      sig: string;
    }[];
    tarball: string;
    unpackedSize: number;
  };
}

export interface IdealTree {
  [name: string]: Omit<PackageJson, 'dependencies'> & {
    dependencies: IdealTree;
  };
}

export interface PackageMetadata {
  versions: Record<string, PackageJson>;
  'dist-tags': {
    latest: string;
    [tag: string]: string;
  };
}

export interface ThemeRegistry {
  parseSpecifier(specifier: string): {
    name: string;
    fetchSpec: string;
    type: 'version' | 'range' | 'tag';
  };
  fetchPackageMetadata(packageName: string): Promise<PackageMetadata>;
  fetchPackageContent(
    idealTree: IdealTree,
    rootPath?: string,
  ): Promise<Map<string, Uint8Array>>;
  buildTreeFromRegistry(specifier: string): Promise<IdealTree>;
}

export function setupThemeRegistry(): ThemeRegistry {
  const registryOrigin = 'https://registry.npmjs.org';
  const metadataCache = new Map<string, PackageMetadata>();
  const contentCache = new Map<string, TarLocalFile[]>();

  function parseSpecifier(specifier: string) {
    const { name, type, fetchSpec } = npa(specifier);
    if (
      !name ||
      !fetchSpec ||
      (type !== 'range' && type !== 'version' && type !== 'tag')
    ) {
      throw new Error(`Unsupported specifier: ${specifier}`);
    }
    return { name, type, fetchSpec };
  }

  async function fetchPackageMetadata(
    packageName: string,
  ): Promise<PackageMetadata> {
    const cached = metadataCache.get(packageName);
    if (cached) {
      return cached;
    }
    const response = await fetch(`${registryOrigin}/${packageName}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch npm metadata: ${packageName}`);
    }
    const metadata = await response.json();
    metadataCache.set(packageName, metadata);
    return metadata;
  }

  async function fetchPackageContent(
    idealTree: IdealTree,
    rootPath = '',
  ): Promise<Map<string, Uint8Array>> {
    const normalize = (
      tree: IdealTree,
      p: string,
    ): [string, Omit<PackageJson, 'dependencies'>][] =>
      Object.values(tree).flatMap((pkg) => {
        const pkgPath = [p, 'node_modules', pkg.name].filter(Boolean).join('/');
        return [
          [pkgPath, pkg] as const,
          ...normalize(pkg.dependencies, pkgPath),
        ];
      });
    return (
      await Promise.all(
        normalize(idealTree, rootPath).map(async ([pkgPath, pkg]) => {
          if (!pkg.dist) {
            return [];
          }
          const cached = contentCache.get(pkg.dist.tarball);
          if (cached) {
            return cached.map((file) => ({
              ...file,
              name: [pkgPath, file.name.replace(/^package\//, '')].join('/'),
            }));
          }

          const tarball = await fetch(pkg.dist.tarball).then((res) =>
            res.arrayBuffer(),
          );
          const hashBuffer = await crypto.subtle.digest('SHA-1', tarball);
          const hash = Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          if (hash !== pkg.dist.shasum) {
            throw new Error(`Incorrect shasum for package ${pkg.name}`);
          }
          // https://github.com/101arrowz/fflate/issues/207
          let unzipped: Uint8Array | undefined;
          new Gunzip((chunk) => {
            unzipped = chunk;
          }).push(new Uint8Array(tarball), true);
          invariant(
            unzipped,
            `Failed to unzip tarball for package ${pkg.name}`,
          );
          const data = untar(unzipped as unknown as ArrayBuffer);
          contentCache.set(pkg.dist.tarball, data);
          return data.map((file) => ({
            ...file,
            name: [pkgPath, file.name.replace(/^package\//, '')].join('/'),
          }));
        }),
      )
    )
      .flat()
      .reduce((map, { name, fileData }) => {
        map.set(name, fileData);
        return map;
      }, new Map<string, Uint8Array>());
  }

  async function buildTreeFromRegistry(specifier: string): Promise<IdealTree> {
    async function build(
      specifier: string,
      isRoot = false,
    ): Promise<IdealTree[string]> {
      const { name, type, fetchSpec } = parseSpecifier(specifier);
      const { versions, 'dist-tags': distTags } =
        await fetchPackageMetadata(name);
      const pkg =
        type === 'tag'
          ? versions[distTags[fetchSpec]]
          : fetchSpec === '*'
            ? versions[distTags.latest]
            : Object.entries(versions).findLast(([v]) =>
                semverSatisfies(v, fetchSpec),
              )?.[1];
      if (!pkg) {
        throw new Error(`Cannot find package ${name}@${fetchSpec}`);
      }
      if (isRoot) {
        // biome-ignore lint/suspicious/noExplicitAny:
        const maybeStyle = (pkg as any).vivliostyle?.theme?.style;
        if (!maybeStyle) {
          throw new Error(
            `Could not find a style file for the theme: ${name}. Please ensure this package satisfies a \`vivliostyle.theme.style\` property.`,
          );
        }
      }
      return {
        ...pkg,
        dependencies: Object.fromEntries(
          await Promise.all(
            Object.entries(pkg.dependencies ?? {}).map(
              async ([name, version]) => [
                name,
                await build(`${name}@${version}`),
              ],
            ),
          ),
        ),
      };
    }

    const { name: packageName } = parseSpecifier(specifier);
    const rootTree: IdealTree = {
      [packageName]: await build(specifier, true),
    };
    const flattenTree = _flattenTree(rootTree);
    return flattenTree;
  }

  function _flattenTree(tree: IdealTree): IdealTree {
    const flatten = (tree: IdealTree, rootTree: IdealTree) => {
      const hoisted: IdealTree[string][] = [];
      for (const pkg of Object.values(tree)) {
        if (!(pkg.name in rootTree)) {
          rootTree[pkg.name] = pkg;
          delete tree[pkg.name];
          hoisted.push(pkg);
        } else {
          const { dependencies } = pkg;
          const newDeps: IdealTree = {};
          pkg.dependencies = newDeps;
          flatten(dependencies, newDeps);
        }
      }
      for (const pkg of hoisted) {
        flatten(pkg.dependencies ?? {}, rootTree);
      }
      return rootTree;
    };
    return flatten(tree, {});
  }

  return {
    parseSpecifier,
    fetchPackageMetadata,
    fetchPackageContent,
    buildTreeFromRegistry,
  };
}
