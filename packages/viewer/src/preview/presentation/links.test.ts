import { describe, expect, it } from 'vitest';

import { linkFragment } from './links';

describe('linkFragment', () => {
  it('returns the id of a fragment link', () => {
    expect(linkFragment('#viv-id-https:3a:2f:2fa')).toBe(
      'viv-id-https:3a:2f:2fa',
    );
    expect(linkFragment(' #note-1 ')).toBe('note-1');
  });

  it('has nothing for links that leave the publication', () => {
    expect(linkFragment('https://example.com/#a')).toBeNull();
    expect(linkFragment('mailto:a@example.com')).toBeNull();
    expect(linkFragment('javascript:alert(1)')).toBeNull();
    expect(
      linkFragment(
        'https://sandbox-a.example.test/vivliostyle/publication.json#epubcfi(/6/2)',
      ),
    ).toBeNull();
  });

  it('has nothing for empty links', () => {
    expect(linkFragment('')).toBeNull();
    expect(linkFragment('#')).toBeNull();
  });
});
