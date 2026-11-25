import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';

import { getMarkdown, PubExtensions } from '@v/tiptap-extensions';
import { newId, referenceTargets, referTo } from './cross-reference';
import {
  footnoteType,
  setFootnote,
  setThemeCss,
  ThemeMarkupExtension,
  themeReferenceTypes,
  themeStyles,
} from './theme-support';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function load(markdown: string): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({}), ThemeMarkupExtension],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editor.commands.setMarkdown(markdown);
  return editor;
}

/** Puts the caret at the end of the textblock holding `needle`. */
function caretAfter(editor: Editor, needle: string): void {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isTextblock && node.textContent.includes(needle)) {
      at = pos + node.nodeSize - 1;
    }
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
  );
}

const DOCUMENT = [
  '# はじめに',
  '## 方法 {#method}',
  '![構成図](a.png){#fig-1}',
  '![写真](b.png)',
  '```js title=app.js {#code}\nx\n```',
  '```js {#plain}\ny\n```',
  '<div class="equation">\n\n$$x$$\n\n</div>',
  '<aside class="sidenote" id="sn-1">\n\n傍注\n\n</aside>',
  '本文 ![小](c.png){#inline} <span id="eq-1">x</span>',
].join('\n\n');

describe('what a reference can point at', () => {
  it('lists headings, figures, captioned code and elements a theme numbers', () => {
    const targets = referenceTargets(load(DOCUMENT).state.doc).map(
      ({ type, id, implicit, label }) => ({ type, id, implicit, label }),
    );
    expect(targets).toEqual([
      { type: 'sec', id: 'はじめに', implicit: true, label: 'はじめに' },
      { type: 'sec', id: 'method', implicit: false, label: '方法' },
      { type: 'fig', id: 'fig-1', implicit: false, label: '構成図' },
      { type: 'fig', id: null, implicit: false, label: '写真' },
      { type: 'lst', id: 'code', implicit: false, label: 'app.js' },
      { type: 'eq', id: null, implicit: false, label: 'x' },
      { type: 'sidenote', id: 'sn-1', implicit: false, label: '傍注' },
    ]);
  });

  it('makes a new id that the document, raw HTML included, has nowhere', () => {
    const { doc } = load(DOCUMENT).state;
    expect(newId(doc, 'eq')).toBe('eq-2');
    expect(newId(doc, 'fig')).toBe('fig-2');
  });
});

describe('referring to a target', () => {
  it('writes the id of a heading made of its text as its own', () => {
    const editor = load('# はじめに\n\n本文');
    caretAfter(editor, '本文');
    const [heading] = referenceTargets(editor.state.doc);
    // A headless editor cannot take focus, so the chains report failure.
    if (heading) {
      referTo(editor, heading);
    }
    expect(getMarkdown(editor)).toBe(
      '# はじめに {#はじめに}\n\n本文<a data-ref="sec" href="#はじめに"></a>',
    );
  });

  it('gives an element and a figure without an id one', () => {
    const editor = load(
      '<div class="equation">\n\n$$x$$\n\n</div>\n\n![図](a.png)\n\n本文',
    );
    caretAfter(editor, '本文');
    const [equation, figure] = referenceTargets(editor.state.doc);
    expect(figure?.id).toBe(null);
    if (equation) {
      referTo(editor, equation);
    }
    caretAfter(editor, '本文');
    const [, again] = referenceTargets(editor.state.doc);
    if (again) {
      referTo(editor, again);
    }
    expect(getMarkdown(editor)).toBe(
      '<div class="equation" id="eq-1">\n\n$$x$$\n\n</div>\n\n![図](a.png){#fig-1}\n\n本文<a data-ref="eq" href="#eq-1"></a><a data-ref="fig" href="#fig-1"></a>',
    );
  });
});

const FOOTNOTE_CSS = '.footnote { float: footnote }';

describe('the markup a theme is offered for', () => {
  it('follows the CSS the editor shows the document with', () => {
    const editor = load('a');
    expect(themeStyles(editor, 'htmlFootnote')).toBe(false);
    setThemeCss(editor, `${FOOTNOTE_CSS}\na[data-ref='fig']::before {}`);
    expect(themeStyles(editor, 'htmlFootnote')).toBe(true);
    expect(themeStyles(editor, 'crossReference')).toBe(true);
    expect(themeStyles(editor, 'tcy')).toBe(false);
    expect([...themeReferenceTypes(editor)]).toEqual(['fig']);
  });

  it('makes the theme’s note where the theme styles one, VFM’s otherwise', () => {
    const editor = load('本文');
    caretAfter(editor, '本文');
    expect(footnoteType(editor)).toBe('inlineFootnote');
    setFootnote(editor, '注');
    setThemeCss(editor, FOOTNOTE_CSS);
    expect(footnoteType(editor)).toBe('htmlFootnote');
    setFootnote(editor, '注');
    expect(getMarkdown(editor)).toBe(
      '本文^[注]<span class="footnote">注</span>',
    );
  });
});
