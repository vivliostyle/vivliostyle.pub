import { Editor, type JSONContent } from '@tiptap/core';
import { VFM } from '@vivliostyle/vfm';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from '@v/tiptap-extensions';
import { m } from '../../../../generated/paraglide/messages';
import { getEditorMenuCommand } from '../registry';
import './code-block';
import './format';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(content: JSONContent[] | string): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editor.commands.setContent(
    typeof content === 'string' ? content : { type: 'doc', content },
    typeof content === 'string' ? { contentType: 'markdown' } : {},
  );
  return editor;
}

function command(id: string) {
  const found = getEditorMenuCommand(id);
  if (!found) {
    throw new Error(`${id} is not registered`);
  }
  return found;
}

/** Puts the caret at the start of the nth textblock. */
function caretIn(editor: Editor, index: number): void {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      positions.push(pos + 1);
    }
  });
  editor.commands.setTextSelection(positions[index] ?? 0);
}

const vfm = VFM({ partial: true });
const render = (markdown: string) => String(vfm.processSync(markdown));

describe('code-block.info', () => {
  it('shows the language of the code block holding the selection', () => {
    const editor = createEditor(
      'a\n\n```js:a.js title=x\nb\n```\n\n```\nc\n```',
    );
    const info = command('code-block.info');

    caretIn(editor, 0);
    expect(info.isVisible?.(editor)).toBe(false);
    caretIn(editor, 1);
    expect(info.isVisible?.(editor)).toBe(true);
    expect(info.value?.(editor)).toBe('js');
    caretIn(editor, 2);
    expect(info.value?.(editor)).toBe(
      m.editor_command_code_block_info_plain_text(),
    );
  });

  it('hides marks inside a code block', () => {
    const editor = createEditor('a\n\n```js\nb\n```');
    for (const id of ['format.bold', 'format.code', 'format.link']) {
      caretIn(editor, 0);
      expect(command(id).isVisible?.(editor)).toBe(true);
      caretIn(editor, 1);
      expect(command(id).isVisible?.(editor)).toBe(false);
    }
  });

  it('writes the info string for VFM as typed', () => {
    const editor = createEditor('```\nconst a = 1;\n```');
    caretIn(editor, 0);
    editor.commands.setCodeBlockInfo('js  title="An example" {#code .lines}');
    const markdown = editor.getMarkdown();

    expect(markdown).toBe(
      '```js  title="An example" {#code .lines}\nconst a = 1;\n```',
    );
    expect(vfm.parse(markdown)).toMatchObject({
      children: [
        { type: 'code', lang: 'js', meta: 'title="An example" {#code .lines}' },
      ],
    });
    expect(render(markdown)).toContain('<figcaption>An example</figcaption>');
    expect(render(markdown)).toContain('id="code"');
  });
});

describe('code block markdown', () => {
  it.each([
    '```\nx\n```',
    '```js\nconst a = 1;\n```',
    '```js title=example.js\nconst a = 1;\n```',
    '```js:example.js\nconst a = 1;\n```',
    '```js   title="a b" {#id .c}\nconst a = 1;\n```',
    '``` js\ttitle=x  \nconst a = 1;\n```',
    '```js {title="{a}"}\nconst a = 1;\n```',
    '~~~md\n```js\na\n```\n~~~',
    '   ```js title=x\n   a\n    b\n   ```',
    '- item\n\n  ```py:hello.py\n  print(1)\n  ```',
    '> ```js title=x\n> a\n> ```',
  ])('renders the same in VFM after a round trip: %j', (markdown) => {
    const editor = createEditor(markdown);
    expect(render(editor.getMarkdown())).toBe(render(markdown));
  });
});
