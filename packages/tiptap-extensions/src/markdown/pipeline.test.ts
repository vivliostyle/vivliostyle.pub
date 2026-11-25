import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from '../index';
import {
  loadAsMarkedDocument,
  readsBackAs,
  unexplainedDifferences,
} from '../testing/markdown-properties';
import {
  currentNotations,
  getMarkdown,
  getMarkdownWithResult,
  MARKED_NOTATIONS,
  parseMarkdown,
  setDocumentNotations,
  setMarkdownBaseline,
  upgradeDocumentNotations,
} from './extension';
import { declareNotation, defineNotation } from './notation';
import { MarkdownWriteError } from './write';

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

/** Appends text to the first textblock holding `needle`. */
function appendTo(editor: Editor, needle: string, text: string): void {
  let end: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (
      end === undefined &&
      node.isTextblock &&
      node.textContent.includes(needle)
    ) {
      end = pos + node.nodeSize - 1;
    }
  });
  if (end === undefined) {
    throw new Error(`No textblock holds ${needle}`);
  }
  editor.view.dispatch(editor.state.tr.insertText(text, end));
}

/** Inserts text after the first occurrence of `needle` in the text. */
function appendAfter(editor: Editor, needle: string, text: string): void {
  let at: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? '').indexOf(needle) : -1;
    if (at === undefined && index !== -1) {
      at = pos + index + needle.length;
    }
  });
  if (at === undefined) {
    throw new Error(`No text holds ${needle}`);
  }
  editor.view.dispatch(editor.state.tr.insertText(text, at));
}

function topLevel(doc: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  doc.forEach((child) => {
    children.push(child);
  });
  return children;
}

describe('saving against the baseline', () => {
  it('keeps frontmatter, line endings and the trailing newline', () => {
    const markdown = '---\r\ntitle: x\r\n---\r\n\r\n# a\r\n\r\nb\r\n';
    const editor = load(markdown);
    expect(editor.state.doc.toString()).toBe(
      'doc(heading("a"), paragraph("b"))',
    );
    expect(parseMarkdown(editor, markdown).frontmatter).toBe(
      '---\ntitle: x\n---\n\n',
    );
    appendTo(editor, 'b', 'c');
    expect(getMarkdown(editor)).toBe(
      '---\r\ntitle: x\r\n---\r\n\r\n# a\r\n\r\nbc\r\n',
    );
  });

  it('changes only the lines of the edited block', () => {
    const markdown =
      'Title\n=====\n\n* one\n* two\n\n\n_a_ and __b__\n\n***\n\n~~~\ncode\n~~~\n\nlast\n';
    const editor = load(markdown);
    appendTo(editor, 'last', '!');
    expect(getMarkdown(editor)).toBe(markdown.replace('last', 'last!'));
  });

  it('writes a new block in the style the document uses', () => {
    const editor = load('* a\n\n_b_\n\n__c__\n\n~~~\nx\n~~~\n');
    const { schema } = editor.state;
    const text = (value: string, mark?: string) =>
      schema.text(value, mark ? [schema.marks[mark].create()] : []);
    const doc = schema.topNodeType.create(null, [
      ...topLevel(editor.state.doc),
      schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, [
          schema.nodes.paragraph.create(null, [
            text('i', 'italic'),
            text(' '),
            text('s', 'bold'),
          ]),
        ]),
      ]),
      schema.nodes.codeBlock.create(null, [text('y')]),
    ]);
    expect(getMarkdown(editor, { doc })).toBe(
      '* a\n\n_b_\n\n__c__\n\n~~~\nx\n~~~\n\n* _i_ __s__\n\n~~~\ny\n~~~\n',
    );
  });

  it('keeps the source of unchanged items of an edited list', () => {
    const markdown = '*   a\n    more\n*   b\n\n    para\n*   c\n';
    const editor = load(markdown);
    appendTo(editor, 'para', '!');
    expect(getMarkdown(editor)).toBe(
      '*   a\n    more\n* b\n\n  para!\n*   c\n',
    );
  });

  it('keeps the source of unchanged blocks in an edited quote', () => {
    const markdown = '> a\n> b\n>\n> ```\n> x\n> ```\n>\n> c\n';
    const editor = load(markdown);
    appendTo(editor, 'c', '!');
    expect(getMarkdown(editor)).toBe(markdown.replace('> c', '> c!'));
  });

  it('renumbers items written after an inserted one', () => {
    const editor = load('1. a\n2. b\n');
    const { schema } = editor.state;
    const list = editor.state.doc.child(0);
    const item = (value: string) =>
      schema.nodes.listItem.create(null, [
        schema.nodes.paragraph.create(null, [schema.text(value)]),
      ]);
    const doc = schema.topNodeType.create(null, [
      list.type.create(list.attrs, [item('new'), ...topLevel(list)]),
    ]);
    expect(getMarkdown(editor, { doc })).toBe('1. new\n2. a\n3. b\n');
  });

  it('keeps two adjacent lists apart', () => {
    const editor = load('- a\n\nbetween\n\n- b\n');
    const [first, , last] = topLevel(editor.state.doc);
    const doc = editor.state.schema.topNodeType.create(null, [first, last]);
    const markdown = getMarkdown(editor, { doc });
    expect(markdown).toBe('- a\n\n* b\n');
    expect(parseMarkdown(editor, markdown).doc.childCount).toBe(2);
  });

  it('escapes only what would be read as syntax', () => {
    const editor = load('');
    const { schema } = editor.state;
    const paragraph = (value: string) =>
      schema.nodes.paragraph.create(null, [schema.text(value)]);
    const doc = schema.topNodeType.create(null, [
      paragraph('a * b, x_y_z, 5 > 3'),
      paragraph('1. not a list'),
      paragraph('*not emphasis*'),
    ]);
    expect(getMarkdown(editor, { doc })).toBe(
      'a * b, x_y_z, 5 > 3\n\n1\\. not a list\n\n\\*not emphasis\\*',
    );
  });

  it('escapes text that a reference elsewhere would make a link', () => {
    const editor = load('[a]: https://example.com\n');
    const { schema } = editor.state;
    const doc = schema.topNodeType.create(null, [
      ...topLevel(editor.state.doc),
      schema.nodes.paragraph.create(null, [schema.text('see [a]')]),
    ]);
    const markdown = getMarkdown(editor, { doc });
    expect(markdown).toBe('[a]: https://example.com\n\nsee \\[a\\]\n');
    expect(parseMarkdown(editor, markdown).doc.eq(doc)).toBe(true);
  });

  it('starts the body with a rule that cannot open frontmatter', () => {
    const editor = load('');
    const { schema } = editor.state;
    const rule = schema.nodes.horizontalRule.create();
    const doc = schema.topNodeType.create(null, [
      rule,
      schema.nodes.paragraph.create(null, [schema.text('a')]),
      rule,
    ]);
    expect(getMarkdown(editor, { doc })).toBe('***\n\na\n\n---');
  });
});

describe('raw markdown', () => {
  it('is kept as written and can be edited as text', () => {
    const editor = load('a <b>c</b> d\n\n<div>\n\nx\n\n</div>\n');
    expect(editor.state.doc.toString()).toBe(
      'doc(paragraph("a ", rawInline("<b>"), "c", rawInline("</b>"), " d"), rawBlock("<div>"), paragraph("x"), rawBlock("</div>"))',
    );
    appendTo(editor, 'x', 'y');
    expect(getMarkdown(editor)).toBe('a <b>c</b> d\n\n<div>\n\nxy\n\n</div>\n');
  });

  it('keeps underline tags as a mark', () => {
    const editor = load('a <u>b</u> c');
    expect(editor.state.doc.toString()).toBe(
      'doc(paragraph("a ", underline("b"), " c"))',
    );
    expect(getMarkdown(editor, { baseline: '' })).toBe('a <u>b</u> c');
  });
});

describe('documents made by the old parser', () => {
  function loadMarked(markdown: string): Editor {
    const editor = load('');
    loadAsMarkedDocument(editor, markdown);
    return editor;
  }

  it.each([
    {
      type: 'ruby',
      attrs: { rubyText: 'かんじ' },
      content: [{ type: 'text', text: '漢字' }],
    },
    { type: 'math', attrs: { latex: 'x', display: false } },
    { type: 'footnoteReference', attrs: { label: '1' } },
    { type: 'inlineFootnote', content: [{ type: 'text', text: '注' }] },
  ])('refuses to write $type, which its definitions lack', (node) => {
    const editor = loadMarked('keep\n\nnew end\n');
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(
      editor.state.tr.insert(end, editor.schema.nodeFromJSON(node)),
    );
    expect(() => getMarkdown(editor)).toThrow(MarkdownWriteError);
  });

  it('keeps the source of blocks the old parser read differently', () => {
    const markdown =
      'text[^1] <span class="x">y</span>\n\n[^1]: note\n\n| a |\n| - |\n\n1. a\n\n   ```js title=x\n   b\n   ```\n- > c\n\nedit me\n';
    const editor = loadMarked(markdown);
    expect(editor.state.doc.toString()).toContain(
      'orderedList(listItem(paragraph("a"), codeBlock("b"))), bulletList(listItem(paragraph, blockquote(paragraph("c"))))',
    );
    expect(editor.state.doc.toString()).toContain(
      'paragraph("text", link("^1"), " <span class=\\"x\\">y</span>")',
    );
    expect(getMarkdown(editor)).toBe(markdown);
    appendTo(editor, 'edit me', '!');
    expect(getMarkdown(editor)).toBe(markdown.replace('edit me', 'edit me!'));
  });

  it('keeps an HTML block as written without any definitions', () => {
    const markdown = '<div class="note">\n\n**md**\n\n</div>\n\nlast\n';
    const editor = loadMarked(markdown);
    appendTo(editor, 'last', '!');
    expect(getMarkdown(editor)).toBe(markdown.replace('last', 'last!'));
  });

  it('keeps a block the old parser dropped where it was', () => {
    const markdown = 'a\n\n| t |\n|---|\n| 1 |\n\nb\n';
    const editor = loadMarked(markdown);
    appendTo(editor, 'a', '!');
    expect(getMarkdown(editor)).toBe(markdown.replace('a\n', 'a!\n'));
  });

  it('keeps the HTML of a paragraph the old parser made of it', () => {
    const markdown = 'a\n\n<div class="x">\n<b>html</b>\n</div>\n\nb\n';
    const editor = loadMarked(markdown);
    const html = editor.state.doc.child(1);
    expect(html.textContent).toContain('<b>html</b>');
    let end = 0;
    editor.state.doc.forEach((node, offset, index) => {
      if (index === 1) {
        end = offset + node.nodeSize - 1;
      }
    });
    editor.view.dispatch(editor.state.tr.insertText('X', end));
    // The old parser kept the blank line after the HTML in the paragraph.
    expect(getMarkdown(editor)).toBe(
      'a\n\n<div class="x">\n<b>html</b>\n</div>\n\nX\n\nb\n',
    );
  });

  it.each([
    ['本文', '注[^1]の本文X\n\n[^1]: note\n'],
    ['注', '注X[^1]の本文\n\n[^1]: note\n'],
  ])('keeps a footnote reference the old parser read as a link, after %j', (needle, expected) => {
    const editor = loadMarked('注[^1]の本文\n\n[^1]: note\n');
    expect(editor.state.doc.toString()).toBe(
      'doc(paragraph("注", link("^1"), "の本文"))',
    );
    appendAfter(editor, needle, 'X');
    expect(getMarkdown(editor)).toBe(expected);
  });

  it('keeps the escapes the old parser read away', () => {
    const markdown = '{漢字|かんじ}と\\{x\\}とa\\\\bと\\*c\\*\n';
    const editor = loadMarked(markdown);
    appendAfter(editor, '{漢字|かんじ}', 'X');
    expect(getMarkdown(editor)).toBe(
      '{漢字|かんじ}Xと\\{x\\}とa\\\\bと\\*c\\*\n',
    );
  });

  it('writes text with the definitions of the time', () => {
    const editor = loadMarked('a ~~b~~ c\n\nd\n');
    expect(currentNotations(editor)).not.toBe(MARKED_NOTATIONS);
    appendTo(editor, 'd', '!');
    expect(getMarkdown(editor)).toBe('a ~~b~~ c\n\nd!\n');
  });
});

function deleteText(editor: Editor, text: string): number {
  let from: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (from === undefined && node.isText && node.text?.includes(text)) {
      from = pos + node.text.indexOf(text);
    }
  });
  if (from === undefined) {
    throw new Error(`No text holds ${text}`);
  }
  editor.view.dispatch(editor.state.tr.delete(from, from + text.length));
  return from;
}

function deleteBlock(editor: Editor, index: number): void {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += editor.state.doc.child(i).nodeSize;
  }
  const { nodeSize } = editor.state.doc.child(index);
  editor.view.dispatch(editor.state.tr.delete(offset, offset + nodeSize));
}

function savesAsDocument(editor: Editor): string {
  const result = getMarkdownWithResult(editor);
  expect(result.strategy).not.toBe('generated');
  expect(readsBackAs(editor, result.markdown, editor.state.doc)).toBe(true);
  expect(
    unexplainedDifferences(editor, result.markdown, editor.state.doc),
  ).toEqual([]);
  return result.markdown;
}

describe('saving keeps what the document means', () => {
  it.each([
    'はじめに\n\n---\n\n本文の段落\n\n---\n\nおわり\n',
    '# 見出し\n\n---\n\ntitle: 本文\n---\n\nおわり\n',
  ])('does not let a rule that comes first open frontmatter: %j', (md) => {
    const editor = load(md);
    deleteBlock(editor, 0);
    const markdown = savesAsDocument(editor);
    expect(markdown.startsWith('***\n')).toBe(true);
    expect(parseMarkdown(editor, markdown).frontmatter).toBe('');
  });

  it.each([
    ['intro\n- first\n  second\n', 'first'],
    ['- first\n\n  second\n- next\n', 'first'],
    ['# T\n\nfirst line\nsecond line\n', 'first line'],
    ['> first\n> second\n', 'first'],
    ['para\n\n- a\n- b\n', 'a'],
  ])('reads back after text at the start of a block goes: %j', (md, text) => {
    const editor = load(md);
    deleteText(editor, text);
    savesAsDocument(editor);
  });

  it('rewrites only the block around a place that reads differently', () => {
    const md =
      '# 章 _題_\n\n以下の通り:\n- 項目A\n- 項目B\n\n本文 _強調_ と user@example.com、a|b、www.example.com。\n\n    indented code\n';
    const editor = load(md);
    deleteText(editor, '項目A');
    const markdown = savesAsDocument(editor);
    expect(markdown).toBe(
      md.replace('以下の通り:\n- 項目A', '以下の通り:\n\n-'),
    );
  });

  it('keeps a setext heading that follows a definition as written', () => {
    const md = '# A *b* _c_\n\n[ref]: http://ex.com\nSetext\n===\n\nlast _x_\n';
    const editor = load(md);
    expect(getMarkdown(editor)).toBe(md);
    appendTo(editor, 'last', 'Z');
    expect(getMarkdown(editor)).toBe(md.replace('last _x_', 'last _xZ_'));
  });

  it.each([
    ['a \\} b c', 'c', 'a \\} b cZ'],
    ['a \\*b\\* c', 'c', 'a \\*b\\* cZ'],
  ])('keeps escapes no definition reads in %j', (md, needle, expected) => {
    const editor = load(md);
    appendTo(editor, needle, 'Z');
    expect(getMarkdown(editor)).toBe(expected);
  });

  it('keeps math as written when the text next to it changes', () => {
    const editor = load('a $\\{x\\}$ and $a \\\\ b$ c');
    appendTo(editor, 'c', 'Z');
    expect(getMarkdown(editor)).toBe('a $\\{x\\}$ and $a \\\\ b$ cZ');
  });

  it('writes a document with the definitions it was made with', () => {
    // Before VFM syntax had definitions, `{b|c}` was text and its braces
    // were not escaped.
    const beforeVfm =
      'document@1 paragraph@1 heading@1 thematicBreak@1 blockquote@1 list@1 codeBlock@1 hardBreak@1 image@1 emphasis@1 strong@1 inlineCode@1 link@1 gfm@1 strikethrough@1 underline@1 raw@1';
    const editor = load('');
    const { schema } = editor.state;
    const doc = schema.topNodeType.create(null, [
      schema.nodes.paragraph.create(null, schema.text('a {b|c} $x$ d')),
    ]);
    editor.commands.setContent(doc.toJSON());
    setMarkdownBaseline(editor, 'a {b|c} $x$ d\n');
    setDocumentNotations(editor, beforeVfm);
    expect(getMarkdown(editor)).toBe('a {b|c} $x$ d\n');
    appendTo(editor, 'd', 'Z');
    expect(getMarkdown(editor)).toBe('a {b|c} $x$ dZ\n');
    setDocumentNotations(editor, null);
    expect(getMarkdown(editor)).toBe('a \\{b\\|c} \\$x\\$ dZ\n');
  });

  it('reads such a document with the current definitions when it is upgraded', () => {
    const editor = load('');
    const { schema } = editor.state;
    editor.commands.setContent(
      schema.topNodeType
        .create(null, [
          schema.nodes.paragraph.create(null, schema.text('a {b|c} d')),
        ])
        .toJSON(),
    );
    setMarkdownBaseline(editor, 'a {b|c} d\n');
    setDocumentNotations(
      editor,
      currentNotations(editor)
        .split(' ')
        .filter((entry) => !entry.startsWith('ruby@'))
        .join(' '),
    );
    expect(upgradeDocumentNotations(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe(
      'doc(paragraph("a ", ruby("b"), " d"))',
    );
    expect(getMarkdown(editor)).toBe('a {b|c} d\n');
  });

  it('keeps the line ending of every line it keeps', () => {
    const md = 'a\r\nb\nc\r\n\r\n```\r\nx\r\ny\n```\r\n';
    const editor = load(md);
    expect(getMarkdown(editor)).toBe(md);
    appendTo(editor, 'c', 'Z');
    expect(getMarkdown(editor)).toBe(md.replace('c\r\n', 'cZ\r\n'));
  });

  it('keeps a byte order mark and the frontmatter after it', () => {
    const md = '﻿---\ntitle: x\n---\n\n# h\n';
    const editor = load(md);
    expect(parseMarkdown(editor, md).frontmatter).toBe(
      '---\ntitle: x\n---\n\n',
    );
    appendTo(editor, 'h', 'Z');
    expect(getMarkdown(editor)).toBe('﻿---\ntitle: x\n---\n\n# hZ\n');
  });

  it('writes a line break in an ATX heading as a tag', () => {
    const editor = load('### 小見出し 続き\n');
    let pos: number | undefined;
    editor.state.doc.descendants((node, p) => {
      if (pos === undefined && node.isText) {
        pos = p + (node.text ?? '').indexOf(' ');
      }
    });
    const { schema } = editor.state;
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        pos ?? 0,
        (pos ?? 0) + 1,
        schema.nodes.hardBreak.create(),
      ),
    );
    expect(savesAsDocument(editor)).toBe('### 小見出し<br>続き\n');
  });

  it.each([
    '連絡は user@example.com まで end',
    '詳細は www.example.com を参照 end',
    'URLはhttps://example.com/a_b_c です end',
  ])('writes an autolink that reads back bare in %j', (md) => {
    const editor = load(md);
    appendTo(editor, 'end', 'Z');
    expect(getMarkdown(editor)).toBe(`${md}Z`);
  });

  it('does not save what cannot be written', () => {
    const editor = load('');
    const { schema } = editor.state;
    const doc = schema.topNodeType.create(null, schema.text('a'));
    expect(() => getMarkdown(editor, { doc })).toThrow(MarkdownWriteError);
  });

  it('keeps the source of the other blocks in what it could not write', () => {
    const editor = load('_x_ y\n\n* z\n');
    const { schema } = editor.state;
    const doc = schema.topNodeType.create(null, [
      ...topLevel(editor.state.doc),
      schema.text('a'),
    ]);
    let error: unknown;
    try {
      getMarkdown(editor, { doc });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MarkdownWriteError);
    expect((error as MarkdownWriteError).markdown).toMatch(/^_x_ y\n\n\* z/);
  });

  it('does not try the same failing document twice', () => {
    const editor = load('');
    const { schema } = editor.state;
    const doc = schema.topNodeType.create(null, schema.text('a'));
    const errorOf = (it: ProseMirrorNode) => {
      try {
        getMarkdown(editor, { doc: it });
      } catch (error) {
        return error;
      }
    };
    const first = errorOf(doc);
    expect(errorOf(doc)).toBe(first);
    expect(errorOf(schema.topNodeType.create(null, schema.text('b')))).not.toBe(
      first,
    );
  });

  it('starts the body on a line of its own after frontmatter alone', () => {
    const editor = load('---\ntitle: x\n---');
    editor.view.dispatch(editor.state.tr.insertText('hello', 1));
    expect(getMarkdown(editor)).toBe('---\ntitle: x\n---\nhello');
  });
});

describe('saving what an edit can leave in a paragraph', () => {
  it('writes a line break on a line of its own with a backslash', () => {
    const editor = load('ab\n');
    const { hardBreak } = editor.state.schema.nodes;
    editor.view.dispatch(
      editor.state.tr.insert(2, [hardBreak.create(), hardBreak.create()]),
    );
    expect(savesAsDocument(editor)).toBe('a  \n\\\nb\n');
  });

  it('writes a line break that starts a line with a backslash', () => {
    const editor = load('a\nb\n');
    editor.view.dispatch(
      editor.state.tr.insert(3, editor.state.schema.nodes.hardBreak.create()),
    );
    expect(savesAsDocument(editor)).toBe('a\n\\\nb\n');
  });

  it('leaves out a paragraph of line breaks', () => {
    const editor = load('ab\n\ncd\n');
    editor.view.dispatch(editor.state.tr.insertText('\n\n', 1, 3));
    expect(savesAsDocument(editor)).toBe('cd\n');
  });

  it('writes a blank line in the text of a paragraph', () => {
    const editor = load('ab\n');
    editor.view.dispatch(editor.state.tr.insertText('\n\n', 2));
    expect(savesAsDocument(editor)).toBe('a&#xA;\nb\n');
  });

  it('writes a backslash before a character reference as a backslash', () => {
    const editor = load('ab\n');
    appendAfter(editor, 'b', '\\ ');
    expect(savesAsDocument(editor)).toBe('ab\\\\&#x20;\n');
  });

  it('writes an ampersand that would start a character reference', () => {
    const editor = load('ab\n');
    appendAfter(editor, 'a', '&amp;');
    expect(savesAsDocument(editor)).toBe('a&#x26;amp;b\n');
  });

  it.each([
    ['[y](u)\n', 'https://x.jp', '<https://x.jp>[y](u)\n'],
    ['`y`\n', 'https://x.jp', '<https://x.jp>`y`\n'],
    ['[y](u)\n', 'www.a.jp', '[www.a.jp](http://www.a.jp)[y](u)\n'],
  ])('ends a URL that would take in what follows: %j after %j', (md, url, expected) => {
    const editor = load(md);
    editor.view.dispatch(
      editor.state.tr.insert(1, editor.state.schema.text(url)),
    );
    expect(savesAsDocument(editor)).toBe(expected);
  });

  it.each([
    ['ab\n', ' *www.a.jp* ', 'a \\*[www.a.jp](http://www.a.jp)\\* b\n'],
    ['ab\n', ' _www.a.jp_ ', 'a \\_[www.a.jp](http://www.a.jp)\\_ b\n'],
    ['ab\n', ' *https://a.jp* ', 'a \\*<https://a.jp>\\* b\n'],
    ['- a\n', ' www.a.jp ', '- a [www.a.jp](http://www.a.jp)&#x20;\n'],
  ])('ends a URL that an escape would go into: %j', (md, text, expected) => {
    const editor = load(md);
    appendAfter(editor, 'a', text);
    expect(savesAsDocument(editor)).toBe(expected);
  });

  it('keeps a link on whitespace that emphasis leaves out', () => {
    const editor = load('text\n');
    const { schema } = editor.state;
    editor.view.dispatch(
      editor.state.tr.insert(5, [
        schema.text('\nSe', [
          schema.marks.link.create({ href: 'u' }),
          schema.marks.bold.create(),
        ]),
        schema.text('te', [schema.marks.bold.create()]),
      ]),
    );
    expect(savesAsDocument(editor)).toBe('text[\n](u)**[Se](u)te**\n');
  });
});

describe('what the document records', () => {
  // Stands for syntax that reads text with percent signs as something else.
  const percent = (version: number, escapes: boolean) =>
    defineNotation({
      name: 'percent',
      version,
      ...(escapes && {
        fromMarkdown: {
          text: (node, context) =>
            /(?:^|[^\\])%/.test(context.source(node))
              ? context.raw(node)
              : undefined,
        },
        escapes: [{ pattern: /%/g }],
      }),
    });

  function withRecord(record: { notations: string | null }): Editor {
    editor = new Editor({
      element: null,
      extensions: [
        PubExtensions.configure({
          notations: [{ ...percent(2, true), earlier: [percent(1, false)] }],
          documentRecord: () => record,
        }),
      ],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    const { schema } = editor.state;
    editor.commands.setContent(
      schema.topNodeType
        .create(null, [
          schema.nodes.paragraph.create(null, schema.text('a %b d')),
        ])
        .toJSON(),
    );
    setMarkdownBaseline(editor, 'a %b d\n');
    return editor;
  }

  const signature = (editor: Editor, version: number) =>
    currentNotations(editor).replace('percent@2', `percent@${version}`);

  it('is read every time the document is written', () => {
    const record: { notations: string | null } = { notations: null };
    const editor = withRecord(record);
    appendTo(editor, 'd', 'Z');
    record.notations = signature(editor, 1);
    expect(getMarkdown(editor)).toBe('a %b dZ\n');
    record.notations = null;
    expect(getMarkdown(editor)).toBe('a \\%b dZ\n');
  });

  it('writes with the version of a definition the document was made with', () => {
    const record: { notations: string | null } = { notations: null };
    const editor = withRecord(record);
    record.notations = signature(editor, 1);
    appendTo(editor, 'd', 'Z');
    expect(getMarkdown(editor)).toBe('a %b dZ\n');
  });

  it('keeps unedited text when the version is not there any more', () => {
    const record: { notations: string | null } = { notations: null };
    const editor = withRecord(record);
    record.notations = signature(editor, 7);
    appendTo(editor, 'd', 'Z');
    expect(getMarkdownWithResult(editor)).toEqual({
      markdown: 'a %b dZ\n',
      strategy: 'reused',
    });
  });
});

describe('documents made with an earlier version of GFM', () => {
  it('keep `~a~` as strikethrough written as it was', () => {
    const editor = load('');
    const { schema } = editor.state;
    const strike = schema.marks.strike.create();
    editor.commands.setContent(
      schema.topNodeType
        .create(null, [
          schema.nodes.paragraph.create(null, [
            schema.text('a '),
            schema.text('b', [strike]),
            schema.text(' c'),
          ]),
          schema.nodes.paragraph.create(null, schema.text('edit')),
        ])
        .toJSON(),
    );
    setMarkdownBaseline(editor, 'a ~b~ c\n\nedit\n');
    setDocumentNotations(
      editor,
      currentNotations(editor).replace('gfm@2', 'gfm@1'),
    );
    appendTo(editor, 'edit', 'ed');
    expect(getMarkdownWithResult(editor)).toEqual({
      markdown: 'a ~b~ c\n\nedited\n',
      strategy: 'reused',
    });
  });
});

describe('declared HTML elements', () => {
  function withElements(): Editor {
    editor = new Editor({
      element: null,
      extensions: [
        PubExtensions.configure({
          notations: [
            declareNotation({
              kind: 'htmlMark',
              name: 'tcy',
              mark: 'tcy',
              tag: 'span',
              match: { class: 'tcy' },
            }),
            declareNotation({
              kind: 'htmlMark',
              name: 'note',
              mark: 'note',
              tag: 'span',
              match: { class: 'footnote' },
              capture: ['id'],
            }),
            declareNotation({
              kind: 'htmlBlock',
              name: 'sidenote',
              node: 'sidenote',
              tag: 'aside',
              match: { class: 'sidenote' },
            }),
          ],
        }),
      ],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    return editor;
  }

  it('reads tags around phrasing as marks with their attributes', () => {
    const editor = withElements();
    editor.commands.setMarkdown(
      'a <span class="tcy">12</span> b <span class="footnote" id="n1">注</span>\n',
    );
    expect(editor.state.doc.toString()).toBe(
      'doc(paragraph("a ", tcy("12"), " b ", note("注")))',
    );
    expect(editor.state.doc.firstChild?.lastChild?.marks[0]?.attrs).toEqual({
      id: 'n1',
    });
    expect(getMarkdown(editor, { baseline: '' })).toBe(
      'a <span class="tcy">12</span> b <span class="footnote" id="n1">注</span>',
    );
  });

  it('does not end an element at the closing tag of one inside it', () => {
    const editor = withElements();
    const markdown =
      'a <span class="footnote" id="n1">x <span class="y">z</span> w</span> b\n';
    editor.commands.setMarkdown(markdown);
    const texts: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((it) => it.type.name === 'note')) {
        texts.push(node.text ?? '');
      }
    });
    expect(texts.join('')).toBe('x <span class="y">z</span> w');
    appendTo(editor, 'b', '!');
    expect(getMarkdown(editor)).toBe(markdown.replace(' b\n', ' b!\n'));
  });

  it('reads character references in the attributes it keeps', () => {
    const editor = withElements();
    editor.commands.setMarkdown(
      '<span class="footnote" id="a&amp;b">注</span>\n',
    );
    expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.attrs).toEqual({
      id: 'a&b',
    });
    expect(getMarkdown(editor, { baseline: '' })).toBe(
      '<span class="footnote" id="a&amp;b">注</span>',
    );
  });

  it('reads an element around blocks as a node', () => {
    const editor = withElements();
    const markdown =
      '<aside class="sidenote">\n\n**側注**\n\n</aside>\n\nafter\n';
    editor.commands.setMarkdown(markdown);
    expect(editor.state.doc.toString()).toBe(
      'doc(sidenote(paragraph(bold("側注"))), paragraph("after"))',
    );
    appendTo(editor, '側注', '!');
    expect(getMarkdown(editor)).toBe(markdown.replace('側注', '側注!'));
  });
});
