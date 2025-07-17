import type { TarLocalFile } from '@andrewbranch/untar.js';

import type { PackageMetadata } from './type';

declare const registryUrlBrand: unique symbol;
export type RegistryUrl = string & { [registryUrlBrand]: never };

export const metadataCache = new Map<string, PackageMetadata>();
export const contentCache = new Map<RegistryUrl, TarLocalFile[]>();
export const fileMap = new Map<string, TarLocalFile>();
export const directorySourceMap = new Map<string, RegistryUrl>();
