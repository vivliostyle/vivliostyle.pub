import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { getMarkdown, PubExtensions } from '../index';
import {
  getEditableSelectionText,
  getSelectedLinkHref,
  insertLink,
  removeLinkFromSelection,
  selectionHasLink,
  setLinkOnSelection,
} from './link';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const href = 'https://example.com';

// "see example site": the link covers "example site" (positions 5–17).
function createEditor(): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            {
              type: 'text',
              text: 'example site',
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
      ],
    },
  });
  return editor;
}

function select(editor: Editor, from: number, to = from): Editor {
  editor.commands.setTextSelection({ from, to });
  return editor;
}

function typeText(editor: Editor, text: string): void {
  editor.commands.command(({ tr }) => {
    tr.insertText(text);
    return true;
  });
}

function inline(editor: Editor): JSONContent[] | undefined {
  return editor.getJSON().content?.[0]?.content;
}

describe('getSelectedLinkHref', () => {
  it('returns the href only when the selection is exactly one link', () => {
    expect(getSelectedLinkHref(select(createEditor(), 5, 17).state)).toBe(href);
  });

  it('ignores part of a link and a link plus plain text', () => {
    expect(getSelectedLinkHref(select(createEditor(), 5, 12).state)).toBe(null);
    expect(getSelectedLinkHref(select(createEditor(), 1, 17).state)).toBe(null);
  });

  it('still reports a link inside the selection for removal', () => {
    expect(selectionHasLink(select(createEditor(), 5, 12).state)).toBe(true);
    expect(selectionHasLink(select(createEditor(), 1, 4).state)).toBe(false);
  });
});

describe('editing a selection', () => {
  it('removes the link only from the selected text', () => {
    const editor = select(createEditor(), 5, 13);
    removeLinkFromSelection(editor);
    expect(inline(editor)).toEqual([
      { type: 'text', text: 'see example ' },
      {
        type: 'text',
        text: 'site',
        marks: [expect.objectContaining({ attrs: expect.anything() })],
      },
    ]);
  });

  it('links only the selected text and rejects unsafe URLs', () => {
    const editor = select(createEditor(), 1, 4);
    expect(setLinkOnSelection(editor, { href: 'javascript:alert(1)' })).toBe(
      false,
    );
    expect(setLinkOnSelection(editor, { href: './chapter.md' })).toBe(true);
    expect(getMarkdown(editor)).toBe(
      `[see](./chapter.md) [example site](${href})`,
    );
  });
});

describe('editing the link text', () => {
  it('offers plain text within one block', () => {
    expect(getEditableSelectionText(select(createEditor(), 5, 17).state)).toBe(
      'example site',
    );
  });

  it('withholds selections a string cannot replace', () => {
    const editor = createEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'c' }] },
      ],
    });
    expect(getEditableSelectionText(select(editor, 1, 4).state)).toBe(null);
    expect(getEditableSelectionText(select(editor, 3, 7).state)).toBe(null);
  });

  it('replaces the text and keeps it selected', () => {
    const editor = select(createEditor(), 5, 17);
    setLinkOnSelection(editor, { href: './docs.md', text: 'docs' });
    expect(getMarkdown(editor)).toBe('see [docs](./docs.md)');
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('docs');
  });

  it('keeps marks shared by the whole selection', () => {
    const editor = createEditor();
    editor.commands.setMarkdown(`**[example](${href})** end`);
    setLinkOnSelection(select(editor, 1, 8), { href, text: 'docs' });
    expect(getMarkdown(editor)).toBe(`[**docs**](${href}) end`);
  });

  it('falls back to the URL when the text is blank', () => {
    const editor = select(createEditor(), 5, 17);
    setLinkOnSelection(editor, { href: 'https://vivliostyle.org', text: ' ' });
    expect(getMarkdown(editor)).toBe('see https://vivliostyle.org');
  });

  it('leaves unchanged text and its formatting alone', () => {
    const editor = createEditor();
    editor.commands.setMarkdown(`see [**exa**mple](${href})`);
    setLinkOnSelection(select(editor, 5, 12), {
      href: './a.md',
      text: 'example',
    });
    expect(getMarkdown(editor)).toBe('see [**exa**mple](./a.md)');
  });
});

describe('insertLink', () => {
  it('inserts the URL itself when no text is given', () => {
    const editor = select(createEditor(), 1);
    expect(insertLink(editor, { href: 'https://vivliostyle.org' })).toBe(true);
    typeText(editor, ' ');
    expect(getMarkdown(editor)).toBe(
      `https://vivliostyle.org see [example site](${href})`,
    );
  });

  it('uses the given text and does not extend the link while typing', () => {
    const editor = select(createEditor(), 1);
    insertLink(editor, { href: './a.md', text: 'A' });
    typeText(editor, '!');
    expect(getMarkdown(editor)).toBe(`[A](./a.md)!see [example site](${href})`);
  });

  it('rejects unsafe URLs', () => {
    const editor = select(createEditor(), 1);
    expect(insertLink(editor, { href: 'javascript:alert(1)' })).toBe(false);
    expect(getMarkdown(editor)).toBe(`see [example site](${href})`);
  });
});
