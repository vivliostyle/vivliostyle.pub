import { Editor } from '@tiptap/core';
import { stringify } from '@vivliostyle/vfm';
import { afterEach, describe, expect, it } from 'vitest';

import { getMarkdown, PubExtensions } from '@v/tiptap-extensions';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function load(markdown: string): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editor.commands.setMarkdown(markdown);
  return editor;
}

function find(editor: Editor, text: string): number {
  let at: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? '').indexOf(text) : -1;
    if (at === undefined && index !== -1) {
      at = pos + index;
    }
  });
  if (at === undefined) {
    throw new Error(`No text holds ${text}`);
  }
  return at;
}

function insertAfter(editor: Editor, needle: string, text: string): void {
  editor.view.dispatch(
    editor.state.tr.insertText(text, find(editor, needle) + needle.length),
  );
}

function html(markdown: string): string {
  return String(
    stringify(markdown, { partial: true, disableFormatHtml: true }),
  );
}

// The manuscript is typeset by VFM, which reads some markdown differently
// from the editor's parser: what the editor saves has to mean to VFM what
// the edit means.
describe('saved markdown as VFM reads it', () => {
  it.each([
    ['bold', '<strong>「重要」</strong>'],
    ['italic', '<em>「重要」</em>'],
    ['strike', '<del>「重要」</del>'],
  ])('marks a quotation %s', (mark, expected) => {
    const editor = load('これは「重要」です。\n');
    const from = find(editor, '「重要」');
    editor.view.dispatch(
      editor.state.tr.addMark(
        from,
        from + 4,
        editor.state.schema.marks[mark].create(),
      ),
    );
    expect(html(getMarkdown(editor))).toBe(`<p>これは${expected}です。</p>`);
  });

  it('keeps a URL typed into a heading a URL', () => {
    const editor = load('# 第一章\n\n本文\n');
    editor.view.dispatch(
      editor.state.tr.insertText('https://a.jp ', find(editor, '第一章')),
    );
    expect(html(getMarkdown(editor))).toBe(
      html('# https://a.jp 第一章\n\n本文\n'),
    );
  });

  it('keeps an email address typed into text an email address', () => {
    const editor = load('本文\n');
    insertAfter(editor, '本文', ' user@example.com まで');
    expect(html(getMarkdown(editor))).toBe(
      '<p>本文 <a href="mailto:user@example.com">user@example.com</a> まで</p>',
    );
  });

  it('keeps math and ruby next to an edit', () => {
    const markdown = '式 $x^2$ を示す。{漢字|かんじ}\n';
    const editor = load(markdown);
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'math') {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            latex: 'x^2 + \\alpha_1',
          }),
        );
      }
    });
    insertAfter(editor, 'を示す', '（価格*1、送料*2）');
    expect(html(getMarkdown(editor))).toBe(
      html('式 $x^2 + \\alpha_1$ を示す（価格\\*1、送料\\*2）。{漢字|かんじ}'),
    );
    expect(html(getMarkdown(editor))).toContain(
      '<ruby>漢字<rt>かんじ</rt></ruby>',
    );
    expect(html(getMarkdown(editor))).toContain('\\(x^2 + \\alpha_1\\)');
  });

  it('keeps two line breaks in a row in the paragraph', () => {
    const editor = load('ab\n');
    const { hardBreak } = editor.state.schema.nodes;
    editor.view.dispatch(
      editor.state.tr.insert(2, [hardBreak.create(), hardBreak.create()]),
    );
    expect(html(getMarkdown(editor))).toBe('<p>a<br>\n<br>\nb</p>');
  });

  it('keeps a blank line and an ampersand typed into the text', () => {
    const editor = load('ab\n');
    insertAfter(editor, 'a', '&amp;\n\n');
    expect(html(getMarkdown(editor))).toBe('<p>a&#x26;amp;\n\nb</p>');
  });

  it('keeps a URL before a link apart from the link', () => {
    const editor = load('[y](u)\n');
    editor.view.dispatch(
      editor.state.tr.insert(1, editor.state.schema.text('https://x.jp')),
    );
    expect(html(getMarkdown(editor))).toBe(
      '<p><a href="https://x.jp">https://x.jp</a><a href="u">y</a></p>',
    );
  });

  it('changes nothing else in VFM when the edit adds only text', () => {
    const markdown = 'a {a|b} $a_1$ c\n';
    const editor = load(markdown);
    insertAfter(editor, ' c', ' __init__ と *1と*2');
    expect(html(getMarkdown(editor))).toBe(
      html(markdown).replace('c</p>', 'c __init__ と *1と*2</p>'),
    );
  });
});
