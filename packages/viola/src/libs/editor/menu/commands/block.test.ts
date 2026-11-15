import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from '@v/tiptap-extensions';
import { getEditorMenuCommand } from '../registry';
import './block';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(block: JSONContent): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [block] },
  });
  editor.commands.setTextSelection({ from: 1, to: 2 });
  return editor;
}

function command(id: string) {
  const found = getEditorMenuCommand(id);
  if (!found) {
    throw new Error(`${id} is not registered`);
  }
  return found;
}

const codeBlock: JSONContent = {
  type: 'codeBlock',
  attrs: { language: 'js' },
  content: [{ type: 'text', text: 'a\nb' }],
};

describe('block commands', () => {
  it('can turn a code block into a list', () => {
    const editor = createEditor(codeBlock);
    expect(command('block.bullet-list').isEnabled?.(editor)).toBe(true);
    command('block.bullet-list').run?.({ editor, surface: 'selection' });
    expect(editor.getJSON().content?.[0]?.type).toBe('bulletList');
  });

  it('can turn a heading into a list', () => {
    const editor = createEditor({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'title' }],
    });
    expect(command('block.ordered-list').isEnabled?.(editor)).toBe(true);
  });

  it('keeps code newlines as hard breaks', () => {
    const editor = createEditor(codeBlock);
    command('block.paragraph').run?.({ editor, surface: 'selection' });
    expect(editor.getJSON().content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a' },
          { type: 'hardBreak' },
          { type: 'text', text: 'b' },
        ],
      },
    ]);
  });

  it('disables the type the selection already has', () => {
    const editor = createEditor(codeBlock);
    expect(command('block.code-block').isEnabled?.(editor)).toBe(false);
    expect(command('block.paragraph').isEnabled?.(editor)).toBe(true);
  });
});
