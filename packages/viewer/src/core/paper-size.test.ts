import { describe, expect, it } from 'vitest';

import { defaultPaperSize } from './paper-size';

describe('defaultPaperSize', () => {
  it('matches the size core uses for `@page { size: A4 }`', () => {
    expect(defaultPaperSize.width).toBeCloseTo(793.7, 1);
    expect(defaultPaperSize.height).toBeCloseTo(1122.5, 1);
  });
});
