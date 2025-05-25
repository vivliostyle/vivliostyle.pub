import assert from 'node:assert';
import path from 'node:path';
import type {
  BuildIdealTreeOptions,
  Options,
  ReifyOptions,
} from '@npmcli/arborist';
import * as Comlink from 'comlink';
import { fs } from 'memfs';
import npa from 'npm-package-arg';
import { satisfies as semverSatisfies } from 'semver';
import type { IdealTree, ThemeRegistry } from '#theme-registry';

interface Node {
  children: Map<string, Node>;
}

const parseSpecifier = (specifier: string) => {
  const { name, type, fetchSpec } = npa(specifier);
  if (
    !name ||
    !fetchSpec ||
    (type !== 'range' && type !== 'version' && type !== 'tag')
  ) {
    throw new Error(`Unsupported specifier: ${specifier}`);
  }
  return { name, type, fetchSpec };
};

const themeRegistry = Comlink.wrap<ThemeRegistry>(
  new BroadcastChannel('worker:theme-registry'),
);

export default class NpmRegistry {
  constructor(public options?: Options) {}

  async loadActual(opt?: Options): Promise<Node> {
    const options = { ...this.options, ...opt };
    const rootNodeModules =
      options.path && path.resolve(options.path, 'node_modules');
    assert(rootNodeModules);
    if (
      !fs.existsSync(rootNodeModules) ||
      !fs.statSync(rootNodeModules).isDirectory()
    ) {
      return { children: new Map() };
    }

    const traverse = (root: string, parent = ''): string[] =>
      fs.readdirSync(root).flatMap((_dirname) => {
        const dirname = _dirname as string;
        const dir = path.resolve(root, dirname);
        if (dirname.startsWith('.') || !fs.statSync(dir).isDirectory()) {
          return [];
        }
        if (dirname.startsWith('@')) {
          return traverse(dir, [parent, dirname].filter(Boolean).join('/'));
        }
        return [parent, dirname].filter(Boolean).join('/');
      });
    const children = traverse(rootNodeModules);
    return {
      children: new Map(
        children.map((name) => [name, { children: new Map() }]),
      ),
    };
  }

  async buildIdealTree(opt?: BuildIdealTreeOptions): Promise<Node> {
    const options = { ...this.options, ...opt };
    const rootPath = options.path;
    assert(rootPath);

    const rootTree = await this._buildTree(rootPath, options);
    const flattenTree = this._flattenTree(rootTree);
    return this._idealTreeToNode(flattenTree);
  }

  async reify(opt?: ReifyOptions): Promise<Node> {
    const options = { ...this.options, ...opt };
    const rootPath = options.path;
    assert(rootPath);

    const rootTree = await this._buildTree(rootPath, options);
    const flattenTree = this._flattenTree(rootTree);
    await this._install(flattenTree, rootPath);
    await this._updatePkgJson(rootTree, rootPath, options.add);
    return this._idealTreeToNode(flattenTree);
  }

  protected async _buildTree(
    rootPath: string,
    { add, rm }: { add?: string[]; rm?: string[] },
  ): Promise<IdealTree> {
    const rootPkgJson = path.resolve(rootPath, 'package.json');
    const rootNodeModules = path.resolve(rootPath, 'node_modules');

    async function buildRemoteTree(
      specifier: string,
    ): Promise<IdealTree[string]> {
      const { name, type, fetchSpec } = parseSpecifier(specifier);
      const { versions, 'dist-tags': distTags } =
        await themeRegistry.fetchPackageMetadata(name);
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
      return {
        ...pkg,
        dependencies: await traverse(pkg),
      };
    }

    async function traverse(parentPkg: {
      name: string;
      dependencies?: Record<string, string>;
    }): Promise<IdealTree> {
      return Object.fromEntries(
        await Promise.all(
          Object.entries(parentPkg.dependencies ?? {}).map(
            async ([name, version]) => {
              const localPkg =
                rootNodeModules &&
                path.resolve(rootNodeModules, name, 'package.json');
              if (localPkg && fs.existsSync(localPkg)) {
                const pkg = JSON.parse(
                  fs.readFileSync(localPkg, 'utf8') as string,
                );
                if (semverSatisfies(pkg.version, version)) {
                  return [
                    name,
                    {
                      ...pkg,
                      dependencies: await traverse(pkg),
                    },
                  ];
                }
              }
              return [name, await buildRemoteTree(`${name}@${version}`)];
            },
          ),
        ),
      );
    }
    let tree: IdealTree = {};
    if (fs.existsSync(rootPkgJson)) {
      tree = await traverse(
        JSON.parse(fs.readFileSync(rootPkgJson, 'utf8') as string),
      );
    }
    for (const specifier of rm ?? []) {
      const { name } = parseSpecifier(specifier);
      delete tree[name];
    }
    for (const specifier of add ?? []) {
      const { name } = parseSpecifier(specifier);
      tree[name] = await buildRemoteTree(specifier);
    }
    return tree;
  }

  protected _flattenTree(tree: IdealTree): IdealTree {
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

  protected async _install(tree: IdealTree, rootPath: string): Promise<void> {
    const fileList = await themeRegistry.fetchPackageContent(tree, rootPath);
    fileList.forEach((fileData, p) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, fileData);
    });
  }

  protected _updatePkgJson(tree: IdealTree, rootPath: string, add?: string[]) {
    const pkgJsonPath = path.resolve(rootPath, 'package.json');
    const pkg = fs.existsSync(pkgJsonPath)
      ? JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8') as string)
      : {};
    const addList = (add ?? []).map(parseSpecifier);
    const dependencies = Object.fromEntries(
      Object.keys(tree)
        .sort()
        .map((name) => {
          const currentVersion = tree[name].version;
          const addPkg = addList.find(({ name: n }) => n === name);
          if (addPkg) {
            if (addPkg.fetchSpec === '*') {
              return [name, `^${currentVersion}`];
            }
            return [name, addPkg.fetchSpec];
          }
          const prev = pkg.dependencies?.[name];
          if (prev && semverSatisfies(currentVersion, prev)) {
            return [name, prev];
          }
          return [name, `^${currentVersion}`];
        }),
    );
    pkg.dependencies = dependencies;
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2));
  }

  protected _idealTreeToNode(tree: IdealTree): Node {
    const toNode = (tree: IdealTree): Node => ({
      children: new Map(
        Object.entries(tree).map(([name, pkg]) => [
          name,
          toNode(pkg.dependencies ?? {}),
        ]),
      ),
    });
    return toNode(tree);
  }
}
