import { describe, expect, it } from 'vitest';

import { pageKeyId } from './page-key';
import { referringPages } from './references';

describe('referringPages', () => {
  it('collects the pages the references were laid out on', () => {
    const references = Object.assign(Object.create(null), {
      'a.html#one': [
        { spineIndex: 1, pageIndex: 0 },
        { spineIndex: 1, pageIndex: 0 },
      ],
      'b.html#two': [{ spineIndex: 3, pageIndex: 2 }],
      'b.html#three': [],
    });
    expect([...(referringPages(references) ?? [])].sort()).toEqual([
      pageKeyId({ spineIndex: 1, pageIndex: 0 }),
      pageKeyId({ spineIndex: 3, pageIndex: 2 }),
    ]);
  });

  it('skips references without a page', () => {
    expect(referringPages({ x: [{ spineIndex: 1 }, {}, null] })?.size).toBe(0);
  });

  it('gives up on a map not shaped as expected', () => {
    expect(referringPages(undefined)).toBeNull();
    expect(referringPages({ x: { spineIndex: 1, pageIndex: 0 } })).toBeNull();
    expect(referringPages({ x: new Set() })).toBeNull();
  });
});
