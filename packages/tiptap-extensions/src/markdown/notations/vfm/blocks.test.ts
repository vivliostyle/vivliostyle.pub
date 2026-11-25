import { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import {
  codeBlockCaption,
  withCodeBlockCaption,
} from '../../../code-block-prism';
import { PubExtensions } from '../../../index';
import {
  currentNotations,
  getMarkdown,
  type PubMarkdownOptions,
  parseMarkdown,
  setDocumentNotations,
  setMarkdownBaseline,
} from '../../extension';
import { MarkdownPipeline } from '../../pipeline';
import { footnoteStatus } from './footnote-definitions';
import { documentIds, headingText, sectionEnds } from './headings';
import { slug } from './slug';

const createEditor = () =>
  new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });

const BLOCK_NOTATIONS = new Set([
  'headingAttributes',
  'sectionEnd',
  'tableOfContents',
  'taskList',
  'imageAlt',
  'footnoteDefinition',
  'inlineImage',
]);

describe('the ids of a document', () => {
  it('numbers repeated headings and keeps their own ids', () => {
    const editor = createEditor();
    const { doc } = parseMarkdown(
      editor,
      '# A\n\n# A\n\n## B {#own}\n\n![f](a.png){#fig}\n\n```js {#code}\nx\n```',
    );
    expect(
      documentIds(doc).map(({ id, kind, explicit }) => [id, kind, explicit]),
    ).toEqual([
      ['a', 'heading', false],
      ['a-1', 'heading', false],
      ['own', 'heading', true],
      ['fig', 'figure', true],
      ['code', 'code', true],
    ]);
  });

  it('leaves notes out of the text of a heading', () => {
    const editor = createEditor();
    const { doc } = parseMarkdown(editor, '# a^[n] {漢字|かんじ} $x$ b');
    expect(headingText(doc.child(0))).toBe('a 漢字  b');
  });

  it('makes ids as github-slugger does', () => {
    expect(slug('Hello World!  Foo')).toBe('hello-world--foo');
    expect(slug('A.B_C-D')).toBe('ab_c-d');
    expect(slug('Ⓐ ① ¹')).toBe('ⓐ--');
    expect(slug('Foo', true)).toBe('Foo');
  });
});

describe('the lines that end sections', () => {
  it('end the open section of their level', () => {
    const editor = createEditor();
    const { doc } = parseMarkdown(
      editor,
      '# A\n\n## B\n\n##\n\n#\n\n#\n\n## C ##\n\n##',
    );
    const ended = [...sectionEnds(doc).values()].map((it) =>
      it ? headingText(it) : null,
    );
    expect(ended).toEqual(['B', 'A', null, null]);
  });

  // As VFM sections a heading by its source, `{…}` on the next line included.
  it.each([
    ['# A #\n{#a}\n\n#', ['A']],
    ['# A {#a} #\n\n#', [null]],
    ['# A #\n\n#', [null]],
  ])('follow the closing sequence of %j as VFM does', (markdown, expected) => {
    const editor = createEditor();
    const { doc } = parseMarkdown(editor, markdown);
    const ended = [...sectionEnds(doc).values()].map((it) =>
      it ? headingText(it) : null,
    );
    expect(ended).toEqual(expected);
  });

  it('let a closing sequence open a section once its attributes go on the next line', () => {
    const editor = createEditor();
    const { doc } = parseMarkdown(editor, '# A {#a} #\n\n#');
    const heading = doc.child(0);
    const italic = editor.schema.marks.italic.create();
    const edited = doc.replace(
      1,
      heading.nodeSize - 1,
      new Slice(Fragment.from(editor.schema.text('A', [italic])), 0, 0),
    );
    expect([...sectionEnds(edited).values()].map(Boolean)).toEqual([true]);
  });
});

describe('the status of notes', () => {
  it('numbers notes as VFM does and finds what is missing', () => {
    const editor = createEditor();
    const { doc } = parseMarkdown(
      editor,
      'a^[in] b[^B] c[^a] d[^b] e[^none]\n\n[^a]: one\n\n[^b]: two\n\n[^b]: again\n\n[^c]: alone',
    );
    const status = footnoteStatus(doc);
    const at = (name: string, label?: string) => {
      const found: number[] = [];
      doc.descendants((node, pos) => {
        if (
          node.type.name === name &&
          (label === undefined || node.attrs.label === label)
        ) {
          found.push(pos);
        }
      });
      return found;
    };
    const [inline] = at('inlineFootnote');
    const [refB, , refb] = at('footnoteReference');
    const [none] = at('footnoteReference', 'none');
    const [defA] = at('footnoteDefinition', 'a');
    const [defB, again] = at('footnoteDefinition', 'b');
    const [alone] = at('footnoteDefinition', 'c');
    expect(status.numbers.get(inline ?? -1)).toBe(1);
    expect(status.numbers.get(refB ?? -1)).toBe(2);
    expect(status.numbers.get(refb ?? -1)).toBe(2);
    expect(status.numbers.get(defB ?? -1)).toBe(2);
    expect(status.numbers.get(defA ?? -1)).toBe(3);
    expect([...status.undefinedReferences]).toEqual([none]);
    expect([...status.duplicateDefinitions]).toEqual([again]);
    expect([...status.unreferencedDefinitions]).toEqual([alone]);
  });
});

describe('code captions', () => {
  it.each([
    ['js:app.js', 'app.js'],
    ['js title="my app.js"', 'my app.js'],
    ['js:app.js title=b', 'b'],
    ["js title='q'", "'q'"],
    ['js {title=t}', 't'],
    ['js:a\\:b', 'a:b'],
    [':app.js', null],
    ['js', null],
  ])('%j has the caption %j', (info, caption) => {
    expect(
      codeBlockCaption(info, info.includes('{title=') ? { title: 't' } : null),
    ).toBe(caption);
  });

  it.each([
    ['js:app.js', 'main.js', 'js:main.js'],
    ['js:app.js', 'a b', 'js title="a b"'],
    ['js title=a {#c}', 'b', 'js title=b {#c}'],
    ['js', '', 'js'],
    ['', 'x', 'text title=x'],
  ])('%j with %j is %j', (info, caption, written) => {
    expect(withCodeBlockCaption(info, caption)).toBe(written);
  });
});

describe('a document recorded before the block syntax', () => {
  const markdown =
    '# 見出し {#id}\n\n#\n\n[[toc]]\n\n- [ ] task\n\n本文 ![a](b.png)\n\n![図 *強調*](c.png)\n\n[^1]: 注';

  function loadInlineEra(editor: Editor) {
    const options = editor.extensionManager.extensions.find(
      (it) => it.name === 'pubMarkdown',
    )?.options as PubMarkdownOptions;
    const notations = options.notations.filter(
      (it) => !BLOCK_NOTATIONS.has(it.name),
    );
    const pipeline = new MarkdownPipeline(editor.schema, notations);
    editor.commands.setContent(pipeline.parse(markdown).doc.toJSON());
    setMarkdownBaseline(editor, markdown);
    setDocumentNotations(editor, pipeline.signature);
    return pipeline;
  }

  it('holds what it held then', () => {
    const editor = createEditor();
    loadInlineEra(editor);
    expect(editor.state.doc.toString()).toBe(
      'doc(heading("見出し {#id}"), heading, paragraph("[[toc]]"), bulletList(listItem(paragraph(rawInline("[ ] "), "task"))), paragraph("本文 ", rawInline("![a](b.png)")), image, rawBlock("[^1]: 注"))',
    );
    expect(editor.state.doc.childAfter(0).node?.attrs.attributes).toBeNull();
  });

  it('is saved as it was, and edited where it is edited', () => {
    const editor = createEditor();
    loadInlineEra(editor);
    expect(getMarkdown(editor)).toBe(markdown);
    const end = editor.state.doc.child(0).nodeSize - 1;
    editor.view.dispatch(editor.state.tr.insertText('X', end));
    expect(getMarkdown(editor)).toBe(markdown.replace('{#id}', '{#id}X'));
  });

  it('is not read with the block syntax', () => {
    const editor = createEditor();
    const pipeline = loadInlineEra(editor);
    expect(pipeline.signature).not.toBe(currentNotations(editor));
    expect(
      [
        editor.can().insertTableOfContents(),
        editor.can().insertSectionEnd(1),
        editor.can().insertFootnoteDefinition('2'),
        editor.can().setHeadingAttributes({ id: 'x' }),
      ].some(Boolean),
    ).toBe(false);
  });
});
