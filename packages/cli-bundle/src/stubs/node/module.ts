import fs from 'node:fs';
import path from 'node:path';

const noop = () => {};

export const builtinModules = [];
export const createRequire = noop;

export const _nodeModulePaths = (from: string) => {
  const paths = [];
  let currentPath = path.resolve(from);
  while (currentPath !== path.parse(currentPath).root) {
    paths.push(path.join(currentPath, 'node_modules'));
    currentPath = path.dirname(currentPath);
  }
  return paths;
};

export const _resolveFilename = (
  request: string,
  parent: { paths: string[] },
): string => {
  const paths = parent.paths || [];
  for (const basePath of paths) {
    const fullPath = path.join(basePath, request);
    for (const ext of ['', '.js', '.json', '.node']) {
      if (fs.existsSync(`${fullPath}${ext}`)) {
        return `${fullPath}${ext}`;
      }
    }
  }
  throw new Error(`Cannot find module '${request}'`);
};

export default {
  builtinModules,
  createRequire,
  _nodeModulePaths,
  _resolveFilename,
};
