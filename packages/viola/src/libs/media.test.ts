import { describe, expect, it } from 'vitest';

import {
  categorizeAsset,
  getMediaAccept,
  getMimeTypeByExtension,
} from './media';

describe('categorizeAsset', () => {
  it('classifies by extension, ignoring case', () => {
    expect(categorizeAsset('assets/cover.PNG')).toBe('image');
    expect(categorizeAsset('fonts/body.woff2')).toBe('font');
    expect(categorizeAsset('audio/intro.m4a')).toBe('audio');
    expect(categorizeAsset('video/clip.webm')).toBe('video');
  });

  it('returns null for non-media files and paths without an extension', () => {
    expect(categorizeAsset('chapter.md')).toBeNull();
    expect(categorizeAsset('assets/README')).toBeNull();
  });
});

describe('getMediaAccept', () => {
  it('lists the dotted extensions of a category', () => {
    expect(getMediaAccept('font')).toBe('.woff,.woff2,.ttf,.otf');
  });
});

describe('getMimeTypeByExtension', () => {
  it('maps known extensions, ignoring case', () => {
    expect(getMimeTypeByExtension('JPG')).toBe('image/jpeg');
    expect(getMimeTypeByExtension('svg')).toBe('image/svg+xml');
  });

  it('returns undefined for unknown extensions', () => {
    expect(getMimeTypeByExtension('md')).toBeUndefined();
  });
});
