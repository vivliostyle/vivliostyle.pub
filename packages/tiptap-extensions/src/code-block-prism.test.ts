import { Editor, type JSONContent } from '@tiptap/core';
import { UndoRedo } from '@tiptap/extensions';
import { undoDepth } from '@tiptap/pm/history';
import type { DecorationSet } from '@tiptap/pm/view';
import refractor from 'refractor';
import { afterEach, describe, expect, it } from 'vitest';

import {
  findSelectedCodeBlock,
  flattenRefractorNodes,
  formatCodeBlockInfo,
  getCodeBlockInfo,
  parseCodeBlockInfo,
  resolveVfmLanguage,
} from './code-block-prism';
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

  it('uses only the first word of the info string', () => {
    expect(resolveVfmLanguage('js title="example"')).toBe('js');
    expect(resolveVfmLanguage('js:example.js {.numberLines}')).toBe('js');
  });

  it('keeps a trailing colon without title, matching VFM', () => {
    expect(resolveVfmLanguage('js:')).toBe('js:');
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

describe('parseCodeBlockInfo', () => {
  it('splits the info string at the first spaces or tabs', () => {
    expect(parseCodeBlockInfo('js:a.js  title="a b" {.c}')).toEqual({
      language: 'js:a.js',
      meta: 'title="a b" {.c}',
    });
    expect(parseCodeBlockInfo(' \tjs ')).toEqual({
      language: 'js',
      meta: null,
    });
    expect(parseCodeBlockInfo('')).toEqual({ language: null, meta: null });
    expect(parseCodeBlockInfo(null)).toEqual({ language: null, meta: null });
  });
});

describe('formatCodeBlockInfo', () => {
  it('joins the language and meta with one space', () => {
    expect(formatCodeBlockInfo({ language: ' js ', meta: ' a=1 ' })).toBe(
      'js a=1',
    );
    expect(formatCodeBlockInfo({ language: 'js', meta: '' })).toBe('js');
    expect(formatCodeBlockInfo({ language: null, meta: null })).toBe('');
  });

  it('keeps the info string on one line', () => {
    expect(formatCodeBlockInfo({ language: 'js', meta: 'a\nb\r\nc' })).toBe(
      'js a b c',
    );
  });

  it('puts `text` before meta without a language', () => {
    expect(formatCodeBlockInfo({ language: ' ', meta: 'title=x' })).toBe(
      'text title=x',
    );
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

function selectedInfo(editor: Editor) {
  const block = findSelectedCodeBlock(editor.state);
  return block && getCodeBlockInfo(block.node);
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
  it('changes the language and meta in one undoable step', () => {
    const editor = createEditor([codeBlock({ language: 'text' })], 5);
    expect(highlightedTexts(editor)).toEqual([]);

    expect(
      editor.commands.setCodeBlockInfo({ language: 'js', meta: 'title=a.js' }),
    ).toBe(true);

    expect(selectedInfo(editor)).toEqual({
      language: 'js',
      meta: 'title=a.js',
    });
    expect(editor.state.doc.textContent).toBe(code);
    expect(editor.state.selection.from).toBe(5);
    expect(highlightedTexts(editor)).toContain('const');
    expect(editor.getMarkdown()).toBe(`\`\`\`js title=a.js\n${code}\n\`\`\``);
    expect(undoDepth(editor.state)).toBe(1);

    editor.commands.undo();
    expect(selectedInfo(editor)).toEqual({ language: 'text', meta: null });
    expect(highlightedTexts(editor)).toEqual([]);
  });

  it('keeps the field it is not given', () => {
    const editor = createEditor(
      [codeBlock({ language: 'js', meta: 'title=a.js' })],
      2,
    );
    editor.commands.setCodeBlockInfo({ language: 'ts' });
    expect(selectedInfo(editor)).toEqual({
      language: 'ts',
      meta: 'title=a.js',
    });
    editor.commands.setCodeBlockInfo({ meta: null });
    expect(selectedInfo(editor)).toEqual({ language: 'ts', meta: null });
  });

  it('stores the values markdown reads back', () => {
    const editor = createEditor([codeBlock({ language: 'js' })], 2);
    editor.commands.setCodeBlockInfo({ language: ' js:a.js  title=x ' });
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      language: 'js:a.js',
      meta: 'title=x',
    });
    editor.commands.setCodeBlockInfo({ language: '', meta: 'title=y' });
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      language: 'text',
      meta: 'title=y',
    });
    editor.commands.setCodeBlockInfo({ language: null, meta: '' });
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      language: null,
      meta: null,
    });
  });

  it('splits an info string stored whole in the language', () => {
    const editor = createEditor([codeBlock({ language: 'js  title=x' })], 2);
    expect(selectedInfo(editor)).toEqual({ language: 'js', meta: 'title=x' });
    editor.commands.setCodeBlockInfo({ meta: 'title=y' });
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      language: 'js',
      meta: 'title=y',
    });
  });

  it('adds no step when nothing changes', () => {
    const editor = createEditor([codeBlock({ language: 'js' })], 2);
    expect(
      editor.commands.setCodeBlockInfo({ language: 'js', meta: ' ' }),
    ).toBe(true);
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
    editor.commands.setCodeBlockInfo({ language: 'js', meta: 'title=a.js' });
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
    expect(editor.commands.setCodeBlockInfo({ language: 'ts' })).toBe(false);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(editor.commands.setCodeBlockInfo({ language: 'ts' })).toBe(false);
    editor.commands.setTextSelection({ from: 5, to: 8 });
    expect(editor.commands.setCodeBlockInfo({ language: 'ts' })).toBe(true);
  });
});
