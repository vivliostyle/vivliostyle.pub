import { Editor, type JSONContent } from '@tiptap/core';
import { UndoRedo } from '@tiptap/extensions';
import { undoDepth } from '@tiptap/pm/history';
import type { DecorationSet } from '@tiptap/pm/view';
import refractor from 'refractor';
import { afterEach, describe, expect, it } from 'vitest';

import { flattenRefractorNodes, resolveVfmLanguage } from './code-block-prism';
import { PubExtensions } from './index';

describe('resolveVfmLanguage', () => {
  it('returns the language as-is', () => {
    expect(resolveVfmLanguage('js')).toBe('js');
  });

  it('returns null when no language is given', () => {
    expect(resolveVfmLanguage(null)).toBeNull();
    expect(resolveVfmLanguage(undefined)).toBeNull();
    expect(resolveVfmLanguage('')).toBeNull();
  });

  it('strips the VFM `lang:title` suffix', () => {
    expect(resolveVfmLanguage('js:example.js')).toBe('js');
  });

  it('skips spaces before the first word, as markdown trims them', () => {
    expect(resolveVfmLanguage(' \tjs title=x')).toBe('js');
    expect(resolveVfmLanguage('   ')).toBeNull();
  });

  it('uses only the first word of the info string', () => {
    expect(resolveVfmLanguage('js title="example"')).toBe('js');
    expect(resolveVfmLanguage('js:example.js {.numberLines}')).toBe('js');
  });

  it('keeps a trailing colon without title, matching VFM', () => {
    expect(resolveVfmLanguage('js:')).toBe('js:');
  });

  it('decodes escapes and character references, as remark does', () => {
    expect(resolveVfmLanguage('js\\:example.js')).toBe('js');
    expect(resolveVfmLanguage('&#106;s')).toBe('js');
    expect(resolveVfmLanguage('c&plus;&plus;')).toBe('c++');
    expect(resolveVfmLanguage('js\\')).toBe('js\\');
  });
});

describe('flattenRefractorNodes', () => {
  it('produces spans matching refractor token classes', () => {
    const source = 'const answer = 42;';
    const spans = flattenRefractorNodes(refractor.highlight(source, 'js'));

    expect(spans.map((span) => span.text).join('')).toBe(source);
    expect(spans).toContainEqual({
      text: 'const',
      classes: ['token', 'keyword'],
    });
    expect(spans).toContainEqual({
      text: '42',
      classes: ['token', 'number'],
    });
  });

  it('merges ancestor classes of nested tokens', () => {
    const spans = flattenRefractorNodes(
      refractor.highlight(`\`a\${b}\``, 'js'),
    );
    const interpolation = spans.find((span) => span.text === 'b');

    expect(interpolation?.classes).toEqual([
      'token',
      'template-string',
      'interpolation',
    ]);
  });
});

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const code = 'const a = 1;';

function codeBlock(attrs: Record<string, unknown>): JSONContent {
  return { type: 'codeBlock', attrs, content: [{ type: 'text', text: code }] };
}

function createEditor(content: JSONContent[], caret: number): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({}), UndoRedo],
    content: { type: 'doc', content },
  });
  // A headless editor's state has no plugins, so undo history and
  // highlighting have to be installed by hand.
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  editor.commands.setTextSelection(caret);
  return editor;
}

function language(editor: Editor): unknown {
  return editor.state.doc.firstChild?.attrs.language;
}

function highlightedTexts(editor: Editor): string[] {
  const plugin = editor.state.plugins.find((p) =>
    (p as unknown as { key: string }).key.startsWith('prismHighlight'),
  );
  const decorations: DecorationSet | undefined = plugin?.getState(editor.state);
  if (!decorations) {
    throw new Error('prismHighlight is not installed');
  }
  return decorations
    .find()
    .map((d) => editor.state.doc.textBetween(d.from, d.to));
}

describe('setCodeBlockInfo', () => {
  it('replaces the info string in one undoable step', () => {
    const editor = createEditor([codeBlock({ language: 'text' })], 5);
    expect(highlightedTexts(editor)).toEqual([]);

    expect(editor.commands.setCodeBlockInfo('js  title="a b"')).toBe(true);

    expect(language(editor)).toBe('js  title="a b"');
    expect(editor.state.doc.textContent).toBe(code);
    expect(editor.state.selection.from).toBe(5);
    expect(highlightedTexts(editor)).toContain('const');
    expect(editor.getMarkdown()).toBe(`\`\`\`js  title="a b"\n${code}\n\`\`\``);
    expect(undoDepth(editor.state)).toBe(1);

    editor.commands.undo();
    expect(language(editor)).toBe('text');
    expect(highlightedTexts(editor)).toEqual([]);
  });

  it('keeps the info string on one line', () => {
    const editor = createEditor([codeBlock({ language: 'js' })], 2);
    editor.commands.setCodeBlockInfo('js a\nb\r\nc');
    expect(language(editor)).toBe('js a b c');
    editor.commands.setCodeBlockInfo('');
    expect(language(editor)).toBeNull();
  });

  it('adds no step when nothing changes', () => {
    const editor = createEditor([codeBlock({ language: 'js' })], 2);
    expect(editor.commands.setCodeBlockInfo('js')).toBe(true);
    expect(undoDepth(editor.state)).toBe(0);
  });

  it('changes a code block nested in a list item', () => {
    const editor = createEditor(
      [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
                codeBlock({ language: null }),
              ],
            },
          ],
        },
      ],
      8,
    );
    editor.commands.setCodeBlockInfo('js title=a.js');
    expect(editor.getMarkdown()).toBe(
      `- a\n\n  \`\`\`js title=a.js\n  ${code}\n  \`\`\``,
    );
  });

  it('needs the whole selection in one code block', () => {
    const editor = createEditor(
      [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        codeBlock({ language: 'js' }),
      ],
      1,
    );
    expect(editor.commands.setCodeBlockInfo('ts')).toBe(false);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(editor.commands.setCodeBlockInfo('ts')).toBe(false);
    editor.commands.setTextSelection({ from: 5, to: 8 });
    expect(editor.commands.setCodeBlockInfo('ts')).toBe(true);
  });
});

describe('info strings with line breaks', () => {
  const injected = 'js\n<img src=x onerror=alert(1)>\r\n# heading';

  it('are written on the fence line', () => {
    const editor = createEditor([codeBlock({ language: injected })], 2);
    expect(editor.getMarkdown()).toBe(
      `\`\`\`js <img src=x onerror=alert(1)> # heading\n${code}\n\`\`\``,
    );
  });

  it('are joined when pasted as HTML', () => {
    const editor = createEditor([codeBlock({ language: 'js' })], 2);
    const rule = editor.schema.nodes.codeBlock?.spec.parseDOM?.[0];
    const element = {
      dataset: { language: injected },
      getAttribute: () => null,
    } as unknown as HTMLElement;
    expect(rule && 'getAttrs' in rule && rule.getAttrs?.(element)).toEqual({
      language: 'js <img src=x onerror=alert(1)> # heading',
    });
  });
});

describe('opening fence typed in a paragraph', () => {
  function paragraph(text: string): JSONContent {
    return { type: 'paragraph', content: [{ type: 'text', text }] };
  }

  // A headless view has no someProp, so the plugins are asked directly, in
  // the order the view would ask them.
  function typeText(editor: Editor, text: string): boolean {
    const { from, to } = editor.state.selection;
    return editor.state.plugins.some((plugin) =>
      plugin.props.handleTextInput?.call(plugin, editor.view, from, to, text),
    );
  }

  function pressEnter(editor: Editor): boolean {
    const event = { key: 'Enter', keyCode: 13 } as KeyboardEvent;
    return editor.state.plugins.some((plugin) =>
      plugin.props.handleKeyDown?.call(plugin, editor.view, event),
    );
  }

  it('does not convert on a space, so that meta can follow', () => {
    const editor = createEditor([paragraph('```js')], 6);

    expect(typeText(editor, ' ')).toBe(false);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('converts on Enter, keeping the whole info string', () => {
    const editor = createEditor([paragraph('```js title=a.js')], 17);

    expect(pressEnter(editor)).toBe(true);

    expect(editor.getJSON().content).toEqual([
      { type: 'codeBlock', attrs: { language: 'js title=a.js' } },
    ]);
    expect(editor.state.selection.from).toBe(1);
  });

  it('converts a fence without an info string', () => {
    const editor = createEditor([paragraph('~~~~')], 5);

    expect(pressEnter(editor)).toBe(true);
    expect(editor.getJSON().content).toEqual([
      { type: 'codeBlock', attrs: { language: null } },
    ]);
  });

  it('converts inside a list item instead of splitting it', () => {
    const editor = createEditor(
      [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [paragraph('a'), paragraph('```js')],
            },
          ],
        },
      ],
      11,
    );

    expect(pressEnter(editor)).toBe(true);
    expect(editor.getJSON().content?.[0].content).toEqual([
      {
        type: 'listItem',
        content: [
          paragraph('a'),
          { type: 'codeBlock', attrs: { language: 'js' } },
        ],
      },
    ]);
  });

  it('leaves a fence where the schema allows no code block', () => {
    const editor = createEditor(
      [
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph('```js')] }],
        },
      ],
      8,
    );

    pressEnter(editor);
    expect(editor.getJSON().content?.[0].content).toHaveLength(2);
  });

  it('leaves Enter alone when the line is not a fence', () => {
    for (const [text, caret] of [
      ['```js', 3],
      ['``js', 5],
      ['a ```js', 8],
      ['```a`b', 7],
    ] as const) {
      const editor = createEditor([paragraph(text)], caret);
      pressEnter(editor);
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      editor.destroy();
    }
  });
});
