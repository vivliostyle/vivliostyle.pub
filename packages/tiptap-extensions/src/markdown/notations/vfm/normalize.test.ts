import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from '../../../index';

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
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  editor.commands.setMarkdown(markdown);
  return editor;
}

describe('keeping VFM nodes in a state markdown holds', () => {
  const emptyRuby = (editor: Editor) =>
    editor.state.tr.insert(
      2,
      editor.schema.nodes.ruby.create({ rubyText: 'x' }),
    );

  it('removes a ruby left without a base', () => {
    const editor = load('ab');
    editor.view.dispatch(emptyRuby(editor));
    expect(String(editor.state.doc)).toBe('doc(paragraph("ab"))');
  });

  it('leaves what another client changed to that client', () => {
    const editor = load('ab');
    editor.view.dispatch(
      emptyRuby(editor).setMeta('y-sync$', { isChangeOrigin: true }),
    );
    expect(String(editor.state.doc)).toBe('doc(paragraph("a", ruby, "b"))');
  });
});
