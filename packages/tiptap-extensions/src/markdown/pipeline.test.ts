import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from '../index';
import { getMarkdown, parseMarkdown, setMarkdownBaseline } from './extension';
import { createLegacyBaselineReader } from './legacy';

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
  it('keeps the source of blocks the old parser read differently', () => {
    const editor = load('');
    const markdown =
      'text[^1] <span class="x">y</span>\n\n[^1]: note\n\n| a |\n| - |\n\n1. a\n\n   ```js title=x\n   b\n   ```\n- > c\n\nedit me\n';
    const reader = createLegacyBaselineReader(
      editor.schema,
      editor.extensionManager.extensions,
    );
    const base = reader.read(markdown);
    const blocks = base?.children.flatMap((child) =>
      child ? [child.node] : [],
    );
    if (!blocks) {
      throw new Error('The old parser did not read the markdown');
    }
    const legacyDoc = editor.schema.topNodeType.create(null, blocks);
    expect(legacyDoc.toString()).toContain(
      'orderedList(listItem(paragraph("a"), codeBlock("b"))), bulletList(listItem(paragraph, blockquote(paragraph("c"))))',
    );
    expect(legacyDoc.toString()).toContain(
      'paragraph("text", link("^1"), " <span class=\\"x\\">y</span>")',
    );
    editor.commands.setContent(legacyDoc.toJSON());
    setMarkdownBaseline(editor, markdown, { legacy: true });
    appendTo(editor, 'edit me', '!');
    expect(getMarkdown(editor)).toBe(markdown.replace('edit me', 'edit me!'));
  });
});
