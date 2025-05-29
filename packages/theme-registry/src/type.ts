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
