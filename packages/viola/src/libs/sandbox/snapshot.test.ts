import { CborEncoder } from '@jsonjoy.com/json-pack/lib/cbor';
import { describe, expect, it } from 'vitest';

import { listSnapshotFiles } from './snapshot';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('listSnapshotFiles', () => {
  it('flattens nested folders into paths and guesses text MIME types', () => {
    const cbor = new CborEncoder().encode([
      0,
      {},
      {
        'vivliostyle.config.json': [1, {}, bytes('{}')],
        'style.css': [1, {}, bytes(':root {}')],
        manuscript: [
          0,
          {},
          {
            'intro.md': [1, {}, bytes('# Intro')],
            assets: [0, {}, { 'cover.png': [1, {}, bytes('png')] }],
          },
        ],
      },
    ]);

    const files = listSnapshotFiles(cbor);

    expect(files.map(({ path, mimeType }) => ({ path, mimeType }))).toEqual([
      { path: 'vivliostyle.config.json', mimeType: 'application/json' },
      { path: 'style.css', mimeType: 'text/css' },
      { path: 'manuscript/intro.md', mimeType: 'text/markdown' },
      {
        path: 'manuscript/assets/cover.png',
        mimeType: 'application/octet-stream',
      },
    ]);
    expect(new TextDecoder().decode(files[2].data)).toBe('# Intro');
  });

  it('skips symlinks and unknown nodes', () => {
    const cbor = new CborEncoder().encode([
      0,
      {},
      {
        link: [2, { target: 'style.css' }],
        unknown: null,
        'style.css': [1, {}, bytes('')],
      },
    ]);

    expect(listSnapshotFiles(cbor).map(({ path }) => path)).toEqual([
      'style.css',
    ]);
  });
});
