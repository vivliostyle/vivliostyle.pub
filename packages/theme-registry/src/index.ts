import { untar } from '@andrewbranch/untar.js';
import { Gunzip } from 'fflate';
import { invariant } from 'outvariant';
import { satisfies as semverSatisfies } from 'semver';

import { locateDefaultThemeFile } from './css-bundler';
import { npa } from './npm-package-arg';
import {
  contentCache,
  directorySourceMap,
  fileMap,
  metadataCache,
  type RegistryUrl,
} from './store';
import type { IdealTree, PackageJson, PackageMetadata } from './type';

export { bundleCss } from './css-bundler';

const registryOrigin = 'https://registry.npmjs.org';

export function parseSpecifier(specifier: string) {
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

export async function fetchPackageMetadata(packageName: string) {
  const cached = metadataCache.get(packageName);
  if (cached) {
    return cached;
  }
  const response = await fetch(`${registryOrigin}/${packageName}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch npm metadata: ${packageName}`);
  }
  const metadata = (await response.json()) as PackageMetadata;
  metadataCache.set(packageName, metadata);
  return metadata;
}

export async function fetchPackageContent(
  idealTree: IdealTree,
): Promise<Map<string, Uint8Array>> {
  const normalize = (
    tree: IdealTree,
    p = '',
  ): [string, Omit<PackageJson, 'dependencies'>][] =>
    Object.values(tree).flatMap((pkg) => {
      const pkgPath = [p, 'node_modules', pkg.name].filter(Boolean).join('/');
      return [[pkgPath, pkg] as const, ...normalize(pkg.dependencies, pkgPath)];
    });
  return (
    await Promise.all(
      normalize(idealTree).map(async ([pkgPath, pkg]) => {
        if (!pkg.dist) {
          return [];
        }
        const tarballUrl = pkg.dist.tarball as RegistryUrl;
        const cached = contentCache.get(tarballUrl);
        if (cached) {
          return cached.map((file) => ({
            ...file,
            name: [pkgPath, file.name].join('/'),
          }));
        }

        const tarball = await fetch(tarballUrl).then((res) =>
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
        invariant(unzipped, `Failed to unzip tarball for package ${pkg.name}`);
        const data = untar(unzipped as unknown as ArrayBuffer).map((file) => ({
          ...file,
          name: file.name.replace(/^package\//, ''),
        }));

        contentCache.set(tarballUrl, data);
        directorySourceMap.set(pkgPath, tarballUrl);
        for (const file of data) {
          fileMap.set([pkgPath, file.name].join('/'), file);
        }
        return data.map((file) => ({
          ...file,
          name: [pkgPath, file.name].join('/'),
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

export async function buildTreeFromRegistry(
  specifier: string,
): Promise<IdealTree> {
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
      // Ensure the package is a Vivliostyle theme package
      locateDefaultThemeFile({ packageJson: pkg });
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
