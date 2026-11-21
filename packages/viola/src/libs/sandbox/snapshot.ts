import { CborDecoder } from '@jsonjoy.com/json-pack/lib/cbor';
import { extname, join } from 'pathe';

// The node layout `@jsonjoy.com/fs-snapshot` encodes (`toBinarySnapshot`).
type SnapshotNode = FolderNode | FileNode | SymlinkNode | UnknownNode;
type FolderNode = [
  type: 0,
  meta: object,
  entries: {
    [child: string]: SnapshotNode;
  },
];
type FileNode = [type: 1, meta: object, data: Uint8Array];
type SymlinkNode = [
  type: 2,
  meta: {
    target: string;
  },
];
type UnknownNode = null;

export interface SnapshotFile {
  path: string;
  mimeType: string;
  data: Uint8Array;
}

// FIXME: Get proper MIME type
function guessMimeType(path: string): string {
  return (
    {
      css: 'text/css',
      json: 'application/json',
      md: 'text/markdown',
      html: 'text/html',
    }[extname(path).slice(1)] || 'application/octet-stream'
  );
}

export function listSnapshotFiles(cbor: Uint8Array): SnapshotFile[] {
  const files: SnapshotFile[] = [];
  const traverse = (node: SnapshotNode, path: string) => {
    if (!node) {
      return;
    }
    switch (node[0]) {
      case 0 /* Folder */:
        for (const [name, entry] of Object.entries(node[2])) {
          traverse(entry, join(path, name));
        }
        break;
      case 1 /* File */:
        files.push({ path, mimeType: guessMimeType(path), data: node[2] });
        break;
    }
  };
  traverse(new CborDecoder().decode(cbor) as SnapshotNode, '');
  return files;
}
