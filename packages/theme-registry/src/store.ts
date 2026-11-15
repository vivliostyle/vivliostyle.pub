import type { TarLocalFile } from '@andrewbranch/untar.js';

import type { PackageMetadata } from './type';

declare const registryUrlBrand: unique symbol;
export type RegistryUrl = string & { [registryUrlBrand]: never };

export const metadataCache = new Map<string, PackageMetadata>();
export const contentCache = new Map<RegistryUrl, TarLocalFile[]>();
export const fileMap = new Map<string, TarLocalFile>();
export const directorySourceMap = new Map<string, RegistryUrl>();

export function mountPackageContent(
  pkgPath: string,
  source: RegistryUrl,
  files: TarLocalFile[],
) {
  const previousSource = directorySourceMap.get(pkgPath);
  if (previousSource && previousSource !== source) {
    // Leftovers of another version would still be resolvable as relative imports
    for (const file of contentCache.get(previousSource) ?? []) {
      fileMap.delete(`${pkgPath}/${file.name}`);
    }
  }
  contentCache.set(source, files);
  directorySourceMap.set(pkgPath, source);
  for (const file of files) {
    fileMap.set(`${pkgPath}/${file.name}`, file);
  }
}
