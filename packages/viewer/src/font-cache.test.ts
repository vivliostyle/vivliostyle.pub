import type { CoreViewer } from '@vivliostyle/core';
import { describe, expect, it, vi } from 'vitest';

import { dropFontCache, isViewFontFaceRule } from './font-cache';

describe('isViewFontFaceRule', () => {
  it('matches the rules core writes for the fonts it maps', () => {
    expect(
      isViewFontFaceRule(
        '@font-face {\n  font-family: Fnt_12;\n  font-weight: 700;\n  src: url("a.woff2");\n}\n',
      ),
    ).toBe(true);
  });

  it('leaves other font rules alone', () => {
    expect(
      isViewFontFaceRule(
        '@font-face { font-family: "Noto Serif"; src: url(a); }',
      ),
    ).toBe(false);
    expect(isViewFontFaceRule('.x { font-family: Fnt_1; }')).toBe(false);
    expect(isViewFontFaceRule('@font-face { font-family: Fnt_Custom; }')).toBe(
      false,
    );
  });
});

describe('dropFontCache', () => {
  it('empties the font mapper of the viewer', () => {
    const fontMapper = { srcURLMap: { a: 1 }, familyCounter: 3 };
    const viewer = { adaptViewer_: { fontMapper } } as unknown as CoreViewer;
    expect(dropFontCache(viewer)).toBe(true);
    expect(fontMapper).toEqual({ srcURLMap: {}, familyCounter: 3 });
  });

  it('does nothing when the internals are not there', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(dropFontCache({} as unknown as CoreViewer)).toBe(false);
      expect(
        dropFontCache({
          adaptViewer_: { fontMapper: {} },
        } as unknown as CoreViewer),
      ).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
