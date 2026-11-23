import { describe, expect, it } from 'vitest';

import { paperSizes } from '../protocol';
import { paperSizeToPx } from './paper-size';

describe('paperSizeToPx', () => {
  it('converts every preset to CSS px', () => {
    for (const paperSize of paperSizes) {
      const { width, height } = paperSizeToPx(paperSize);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(width);
    }
  });

  it('matches the sizes core uses for the named page sizes', () => {
    const a4 = paperSizeToPx('a4');
    expect(a4.width).toBeCloseTo(793.7, 1);
    expect(a4.height).toBeCloseTo(1122.5, 1);
    expect(paperSizeToPx('letter')).toEqual({ width: 816, height: 1056 });
    expect(paperSizeToPx('jis-b5').width).toBeCloseTo((182 * 96) / 25.4);
  });

  it('returns a copy', () => {
    paperSizeToPx('a5').width = 0;
    expect(paperSizeToPx('a5').width).toBeGreaterThan(0);
  });
});
