import { describe, expect, it } from 'vitest';

import {
  formatAttributes,
  parseAttributes,
  renderedAttributes,
  writableAttributes,
} from './attributes';

describe('attributes on the editor’s elements', () => {
  it('leave out names a DOM element cannot have', () => {
    expect(
      renderedAttributes({ 'http://example.com': '', 'a|b': '', title: '1' }),
    ).toEqual({ title: '1' });
  });

  it('are only those a theme can select the element by', () => {
    expect(
      renderedAttributes({
        id: 'i',
        lang: 'ja',
        dir: 'rtl',
        title: 't',
        role: 'note',
        'aria-label': 'l',
        hidden: '',
        'data-x': 'y',
        name: 'n',
        popover: '',
        autofocus: '',
        tabindex: '0',
        target: '_top',
        k: 'v',
        width: '10',
        'data-mark': 'm',
        'data-type': 't',
      }),
    ).toEqual({
      id: 'i',
      lang: 'ja',
      dir: 'rtl',
      title: 't',
      role: 'note',
      'aria-label': 'l',
      hidden: '',
      'data-x': 'y',
    });
  });

  it('are the size of an image too', () => {
    expect(renderedAttributes({ width: '10', height: '5' }, 'img')).toEqual({
      width: '10',
      height: '5',
    });
  });

  it('leave out what runs script or what the editor relies on', () => {
    expect(
      renderedAttributes({
        onClick: 'x',
        onpointerdown: 'x',
        style: 'position: fixed',
        ping: 'u',
        formaction: 'u',
        srcdoc: '<p>',
        href: 'u',
        'data-raw-inline': '',
        'data-math-typeset': 'true',
        'data-pm-slice': '1',
        'data-note': 'kept',
        class: 'footnote-ref x math footnote',
      }),
    ).toEqual({ 'data-note': 'kept', class: 'x' });
  });
});

describe('attributes as written', () => {
  it('read an id given by a key and then by a hash as VFM does', () => {
    expect(parseAttributes('{id=a #b}')).toEqual({ id: 'b' });
    expect(parseAttributes('{#a id=b}')).toEqual({ id: 'a' });
  });

  it('write back what they read', () => {
    for (const source of [
      '{#i .a .b k="v w" flag}',
      '{k=a\\b}',
      '{k="}"}',
      '{}',
    ]) {
      const read = parseAttributes(source);
      expect(read && parseAttributes(formatAttributes(read) ?? '')).toEqual(
        read,
      );
    }
  });

  it('are not written where no markdown holds them', () => {
    expect(writableAttributes({ k: 'a b\\' })).toBeNull();
    expect(writableAttributes({ k: 'a\nb' })).toBeNull();
    expect(writableAttributes({ class: '', id: 'x' })).toEqual({ id: 'x' });
  });
});
