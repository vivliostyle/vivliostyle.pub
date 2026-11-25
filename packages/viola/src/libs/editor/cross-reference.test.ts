import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';

import { getMarkdown, PubExtensions } from '@v/tiptap-extensions';
import { newId, referenceTargets, referTo } from './cross-reference';
import { getEditorMenuCommand } from './menu/registry';
import {
  isStyled,
  StyledElementsExtension,
  setEditorCss,
  styledReferenceTypes,
} from './styled-elements';

import './menu/commands';

function command(id: string) {
  const found = getEditorMenuCommand(id);
  if (!found) {
    throw new Error(`${id} is not registered`);
  }
  return found;
}

const visible = (editor: Editor, id: string) =>
  command(id).isVisible?.(editor) ?? true;

/** Selects the text `needle`. */
function selectAll(editor: Editor, needle: string): void {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? '').indexOf(needle) : -1;
    if (from === -1 && index !== -1) {
      from = pos + index;
    }
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, from + needle.length),
    ),
  );
}

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function load(markdown: string): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({}), StyledElementsExtension],
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

  it('leaves out what VFM makes no section or figure of', () => {
    const targets = referenceTargets(
      load('> # 引用\n\n## 閉じる ##\n\n![](a.png)\n\n- # 項目\n\n# 本文').state
        .doc,
    ).map(({ type, id }) => ({ type, id }));
    expect(targets).toEqual([
      { type: 'sec', id: '項目' },
      { type: 'sec', id: '本文' },
    ]);
  });

  it('gives a heading whose id would be made of no text an id', () => {
    const editor = load('# 🎉\n\n# ***\n\n本文');
    const targets = referenceTargets(editor.state.doc);
    expect(targets.map((it) => it.id)).toEqual([null, '-1']);
    caretAfter(editor, '本文');
    const [first] = targets;
    if (first) {
      referTo(editor, first);
    }
    expect(getMarkdown(editor)).toBe(
      '# 🎉 {#sec-1}\n\n# ***\n\n本文<a data-ref="sec" href="#sec-1"></a>',
    );
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
    expect(isStyled(editor, 'htmlFootnote')).toBe(false);
    setEditorCss(editor, `${FOOTNOTE_CSS}\na[data-ref='fig']::before {}`);
    expect(isStyled(editor, 'htmlFootnote')).toBe(true);
    expect(isStyled(editor, 'crossReference')).toBe(true);
    expect(isStyled(editor, 'tcy')).toBe(false);
    expect([...styledReferenceTypes(editor)]).toEqual(['fig']);
  });

  it('offers VFM’s note always and the theme’s where the theme styles it', () => {
    const editor = load('本文');
    selectAll(editor, '本文');
    expect(visible(editor, 'format.footnote')).toBe(true);
    expect(visible(editor, 'format.page-footnote')).toBe(false);
    setEditorCss(editor, FOOTNOTE_CSS);
    expect(visible(editor, 'format.page-footnote')).toBe(true);
    command('format.page-footnote').run?.({ editor, surface: 'selection' });
    expect(getMarkdown(editor)).toBe('<span class="footnote">本文</span>');
  });

  it('keeps commands for markup the selection is in, whatever the theme', () => {
    const editor = load(
      '<span class="footnote">注</span><span class="tcy">12</span>\n\n<div class="note">\n\n箱\n\n</div>',
    );
    selectAll(editor, '注');
    expect(visible(editor, 'format.page-footnote')).toBe(true);
    command('format.page-footnote').run?.({ editor, surface: 'selection' });
    selectAll(editor, '12');
    expect(visible(editor, 'format.tcy')).toBe(true);
    command('format.tcy').run?.({ editor, surface: 'selection' });
    caretAfter(editor, '箱');
    expect(visible(editor, 'block.note')).toBe(true);
    expect(visible(editor, 'block.theorem')).toBe(false);
    expect(visible(editor, 'element.unwrap')).toBe(true);
    command('element.unwrap').run?.({ editor, surface: 'selection' });
    expect(getMarkdown(editor)).toBe('注12\n\n箱');
  });
});
