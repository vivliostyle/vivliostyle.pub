import { Editor } from '@tiptap/core';
import type { DOMSerializer, TagParseRule } from '@tiptap/pm/model';
import { afterAll, describe, expect, it } from 'vitest';

import { PubExtensions } from '../../../index';
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

describe('attributes on the clipboard', () => {
  const editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  afterAll(() => {
    editor.destroy();
  });
  const serializer = editor.extensionManager.plugins
    .map((plugin) => plugin.props.clipboardSerializer)
    .find(Boolean) as DOMSerializer;
  const { schema } = editor;

  // An element of the tag with the attributes, as far as parsing reads it.
  const element = (attrs: Record<string, string>) =>
    ({
      getAttribute: (name: string) => attrs[name] ?? null,
      hasAttribute: (name: string) => name in attrs,
      style: {},
    }) as unknown as HTMLElement;

  const readAs = (type: 'bold' | 'link', attrs: Record<string, string>) => {
    const tag = type === 'bold' ? 'strong' : 'a[href]';
    const rule = schema.marks[type].spec.parseDOM?.find(
      (it) => (it as TagParseRule).tag === tag,
    ) as TagParseRule;
    const read = rule.getAttrs?.(element(attrs));
    return read ? (read.attributes ?? null) : null;
  };

  it('are all carried by copied HTML', () => {
    const mark = schema.marks.bold.create({
      attributes: { class: 'x', foo: 'bar' },
    });
    const [tag, attrs] = serializer.marks.bold(mark, true) as [
      string,
      Record<string, string>,
    ];
    expect(tag).toBe('strong');
    expect(attrs).toMatchObject({
      class: 'x',
      'data-vfm-attributes': '{"class":"x","foo":"bar"}',
    });
    expect(readAs('bold', attrs)).toEqual({ class: 'x', foo: 'bar' });
  });

  it('are not added where there are none', () => {
    const [, attrs] = serializer.marks.link(
      schema.marks.link.create({ href: 'u' }),
      true,
    ) as [string, Record<string, string>];
    expect(attrs).not.toHaveProperty('data-vfm-attributes');
  });

  it('are not read from HTML that was not copied from the editor', () => {
    expect(readAs('bold', { class: 'x', id: 'y' })).toBeNull();
    expect(
      readAs('link', { href: 'u', 'data-vfm-attributes': '{"a":1}' }),
    ).toBeNull();
    expect(
      readAs('link', { href: 'u', 'data-vfm-attributes': '{"a"' }),
    ).toBeNull();
  });

  it('are kept apart from the attributes the editor renders', () => {
    expect(renderedAttributes({ 'data-vfm-attributes': '{}' })).toEqual({});
  });
});
