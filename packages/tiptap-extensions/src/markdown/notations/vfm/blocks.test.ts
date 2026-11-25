import { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';

import {
  codeBlockCaption,
  withCodeBlockCaption,
} from '../../../code-block-prism';
import { PubExtensions } from '../../../index';
import { documentHtml } from '../../../testing/html';
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
  'paragraphContinuation',
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
    expect(slug('🅰 🄰 ⒜')).toBe('🅰-🄰-');
    expect(slug('新\u9ffd\u{2a6de}\u{20000}')).toBe('新\u{20000}');
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
    ['js title=a=b', 'a'],
    ['js title="a=b c"', 'a'],
    ['js title==b', null],
    ['js:a=b', 'a=b'],
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
    ['js', 'x=y', 'js:x=y'],
    ['js:app.js', 'x=y', 'js:x=y'],
    ['js {#c}', 'x=y', 'js:x=y {#c}'],
    ['js title=a', 'x=y', null],
    ['js', 'x = y', null],
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

describe('HTML on the clipboard', () => {
  // Enough of an element for the parse rules, which tests have no DOM for.
  const element = (attributes: Record<string, string>, checkbox?: boolean) =>
    ({
      getAttribute: (name: string) => attributes[name] ?? null,
      hasAttribute: (name: string) => name in attributes,
      classList: {
        contains: (name: string) =>
          (attributes.class ?? '').split(' ').includes(name),
      },
      querySelector: () =>
        checkbox === undefined ? null : { checked: checkbox },
    }) as unknown as HTMLElement;

  it('keeps whether a task is checked without its checkbox', () => {
    const editor = createEditor();
    const { doc } = parseMarkdown(editor, '- [x] a\n- [ ] b');
    expect(documentHtml(doc)).toBe(
      '<ul><li class="task-list-item" data-checked="true"><p>a</p></li><li class="task-list-item" data-checked="false"><p>b</p></li></ul>',
    );
    const [rule] = editor.schema.nodes.listItem.spec.parseDOM ?? [];
    const checked = (it: HTMLElement) => rule?.getAttrs?.(it);
    expect([
      checked(element({ class: 'task-list-item', 'data-checked': 'true' })),
      checked(element({ class: 'task-list-item' }, true)),
      checked(element({ class: 'task-list-item' }, false)),
      checked(element({})),
    ]).toEqual([
      expect.objectContaining({ checked: true }),
      expect.objectContaining({ checked: true }),
      expect.objectContaining({ checked: false }),
      {},
    ]);
  });

  it('reads an image as one in text where the document has them', () => {
    const editor = createEditor();
    editor.commands.setMarkdown('a');
    const rules = editor.schema.nodes.inlineImage.spec.parseDOM ?? [];
    const [rule] = rules;
    expect(rule?.tag).toBe('img[src]');
    expect(rule?.priority).toBeGreaterThan(50);
    const img = element({ src: 'a.png', alt: 'a' });
    expect(rule?.getAttrs?.(img)).toEqual(
      expect.objectContaining({ src: 'a.png', alt: 'a' }),
    );
    setDocumentNotations(
      editor,
      currentNotations(editor)
        .split(' ')
        .filter((entry) => !entry.startsWith('inlineImage@'))
        .join(' '),
    );
    expect(rule?.getAttrs?.(img)).toBe(false);
  });
});

describe('the decorations of the whole document', () => {
  const KEYS = ['footnoteStatus$', 'headingIds$', 'sectionEnds$', 'taskList$'];

  function decorations(state: EditorState) {
    return KEYS.map((key) => {
      const plugin = state.plugins.find(
        (it) => (it as unknown as { key: string }).key === key,
      );
      return (plugin?.getState(state) as DecorationSet | undefined)
        ?.find()
        .map((it) => {
          const { attrs } = (it as unknown as { type: { attrs?: unknown } })
            .type;
          return [it.from, it.to, JSON.stringify(attrs ?? it.spec)];
        });
    });
  }

  it('are the ones made anew after each edit, mapped or not', () => {
    const editor = createEditor();
    editor.view.updateState(
      editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
    );
    editor.commands.setMarkdown(
      '# A\n\n本文[^1]と[^2]。\n\n## B\n\n- [x] 済み\n- 項目\n\n##\n\n[^1]: 注\n\n[^2]: 注二\n\n[^3]: 余り',
    );
    const at = (text: string) => {
      let found = -1;
      editor.state.doc.descendants((node, pos) => {
        if (found === -1 && node.isText && node.text?.includes(text)) {
          found = pos + node.text.indexOf(text);
        }
      });
      return found;
    };
    const edits = [
      () => editor.state.tr.insertText('X', at('本文')),
      () => editor.state.tr.insertText('Y', at('B')),
      () => editor.state.tr.insertText('Z', at('済み')),
      () => editor.state.tr.delete(at('と'), at('と') + 1),
      () =>
        editor.state.tr.insert(
          at('項目'),
          editor.schema.nodes.footnoteReference.create({ label: '3' }),
        ),
      () => editor.state.tr.insertText('W', at('余り')),
    ];
    for (const edit of edits) {
      editor.view.dispatch(edit());
      const fresh = EditorState.create({
        doc: editor.state.doc,
        plugins: editor.state.plugins,
      });
      expect(decorations(editor.state)).toEqual(decorations(fresh));
    }
  });
});
