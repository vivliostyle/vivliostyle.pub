import { Editor } from '@tiptap/core';
import type { DecorationSet } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';

import { PubExtensions } from '../../../index';
import { followsLink } from './cross-reference';

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

describe('references whose target the document lacks', () => {
  const createEditor = (markdown: string) => {
    const editor = new Editor({
      element: null,
      extensions: [PubExtensions.configure({})],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    editor.view.updateState(
      editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
    );
    editor.commands.setMarkdown(markdown);
    return editor;
  };
  const missing = (editor: Editor) => {
    const found: string[] = [];
    for (const plugin of editor.state.plugins) {
      const set = plugin.props.decorations?.call(plugin, editor.state) as
        | DecorationSet
        | null
        | undefined;
      for (const decoration of set?.find() ?? []) {
        const { attrs } = (
          decoration as unknown as { type: { attrs?: object } }
        ).type;
        if (attrs && 'data-missing' in attrs) {
          found.push(
            String(editor.state.doc.nodeAt(decoration.from)?.attrs.href),
          );
        }
      }
    }
    return found;
  };

  it('follow edits that make or take away their target', () => {
    const editor = createEditor(
      'see <a data-ref="sec" href="#a"></a> and <a data-ref="sec" href="#b"></a>\n\n# A',
    );
    expect(missing(editor)).toEqual(['#b']);
    editor.view.dispatch(editor.state.tr.insertText('x', 1));
    expect(missing(editor)).toEqual(['#b']);
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.insertText('B', end - 1, end));
    expect(missing(editor)).toEqual(['#a']);
    editor.destroy();
  });
});
