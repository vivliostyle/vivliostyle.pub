import { describe, expect, it } from 'vitest';

import {
  clampZoomScale,
  isZoom,
  maxZoomScale,
  minZoomScale,
  parseZoom,
  stepZoomScale,
} from './protocol';

describe('isZoom', () => {
  it('accepts the fits and positive scales', () => {
    expect(isZoom('fit-width')).toBe(true);
    expect(isZoom('fit-page')).toBe(true);
    expect(isZoom(1.5)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isZoom('fit')).toBe(false);
    expect(isZoom(0)).toBe(false);
    expect(isZoom(-1)).toBe(false);
    expect(isZoom(Number.NaN)).toBe(false);
    expect(isZoom(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isZoom('1.5')).toBe(false);
  });
});

describe('parseZoom', () => {
  it('reads a fit or a scale', () => {
    expect(parseZoom('fit-page')).toBe('fit-page');
    expect(parseZoom('1.25')).toBe(1.25);
  });

  it('gives null for a missing or invalid value', () => {
    expect(parseZoom(null)).toBeNull();
    expect(parseZoom('')).toBeNull();
    expect(parseZoom('large')).toBeNull();
    expect(parseZoom('0')).toBeNull();
  });
});

describe('clampZoomScale', () => {
  it('keeps a scale within the limits', () => {
    expect(clampZoomScale(0.01)).toBe(minZoomScale);
    expect(clampZoomScale(100)).toBe(maxZoomScale);
    expect(clampZoomScale(1.2)).toBe(1.2);
  });
});

describe('stepZoomScale', () => {
  it('moves to the neighboring step', () => {
    expect(stepZoomScale(1, 'in')).toBe(1.1);
    expect(stepZoomScale(1, 'out')).toBe(0.9);
  });

  it('moves from between steps to the nearest one that way', () => {
    expect(stepZoomScale(0.87, 'in')).toBe(0.9);
    expect(stepZoomScale(0.87, 'out')).toBe(0.8);
  });

  it('treats a scale within half a percent of a step as on it', () => {
    expect(stepZoomScale(0.998, 'in')).toBe(1.1);
    expect(stepZoomScale(1.004, 'out')).toBe(0.9);
  });

  it('stops past the last step', () => {
    expect(stepZoomScale(maxZoomScale, 'in')).toBeNull();
    expect(stepZoomScale(minZoomScale, 'out')).toBeNull();
    expect(stepZoomScale(0.1, 'in')).toBe(0.25);
  });
});
