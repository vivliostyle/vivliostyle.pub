import { describe, expect, it } from 'vitest';

import { followsLink } from './theme';

// Stand for the DOM, which the tests have none of.
function element(link: object | null): Element {
  return { closest: () => link } as unknown as Element;
}

function click(target: Element | null): Event {
  return { target } as unknown as Event;
}

describe('clicks on links of the document', () => {
  const link = {};
  const root = { contains: (node: unknown) => node === link } as Node;

  it('are kept from following a link in the editor', () => {
    expect(followsLink(click(element(link)), root)).toBe(true);
  });

  it('leave clicks elsewhere alone', () => {
    expect(followsLink(click(element(null)), root)).toBe(false);
    expect(followsLink(click(element({})), root)).toBe(false);
    expect(followsLink(click(null), root)).toBe(false);
  });
});
