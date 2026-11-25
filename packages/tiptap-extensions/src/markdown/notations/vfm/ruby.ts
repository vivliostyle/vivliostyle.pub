import { Node } from '@tiptap/core';
import {
  Fragment,
  type Mark,
  type Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import { type EditorState, Plugin } from '@tiptap/pm/state';

import { hasDocumentNotation } from '../../extension';
import type { UnknownMdastNode } from '../../mdast';
import {
  type Code,
  codes,
  currentNode,
  type Effects,
  enterNode,
  type FromMarkdownExtension,
  isLineEnding,
  OpenDelimiters,
  type State,
  syntaxPlugin,
  type TokenizeContext,
  tokenType,
} from '../../micromark';
import { defineNotation } from '../../notation';
import {
  findSelectedInline,
  insertInline,
  unwrap,
  wrapSelection,
} from './commands';
import { inlineSourceRules, sharedMarks } from './input-rules';
import { inlineNodeRules } from './normalize';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ruby: {
      /**
       * Sets the ruby text of the ruby the selection is in, or makes a ruby
       * of the selected text.
       */
      setRuby: (rubyText: string) => ReturnType;
      /** Leaves the base of the ruby the selection is in as text. */
      unsetRuby: () => ReturnType;
      /** Inserts a ruby in place of the selection. */
      insertRuby: (ruby: { base: string; rubyText: string }) => ReturnType;
    };
  }
}

const types = {
  ruby: tokenType('vfmRuby'),
  marker: tokenType('vfmRubyMarker'),
  base: tokenType('vfmRubyBase'),
  text: tokenType('vfmRubyText'),
  chunk: tokenType('chunkText'),
};

interface RubyMdast extends UnknownMdastNode {
  rubyText: string;
}

// VFM matches a ruby with `.`, which stops at these as well as at line
// endings.
function endsRuby(code: Code): boolean {
  return (
    code === null || isLineEnding(code) || code === 0x2028 || code === 0x2029
  );
}

/**
 * `{base|ruby}` as VFM 2 reads it: the base runs to the first `|` that does
 * not follow `\` or `|`, the ruby text to the first `}` after at least one
 * character, both on one line. Braces in the base do not pair.
 */
function tokenizeRuby(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const open = new OpenDelimiters(this);
  let previous: Code = null;
  let size = 0;

  // Emphasis or a link opened before would end inside, and VFM 2 reads
  // that first.
  const ends = (code: Code) => open.ends(code);

  const start: State = (code) => {
    if (code !== codes.leftCurlyBrace) {
      return nok(code);
    }
    effects.enter(types.ruby);
    effects.enter(types.marker);
    effects.consume(code);
    effects.exit(types.marker);
    return baseStart;
  };

  const baseStart: State = (code) => {
    if (endsRuby(code)) {
      return nok(code);
    }
    effects.enter(types.base);
    effects.enter(types.chunk, { contentType: 'text' });
    return base(code);
  };

  const base: State = (code) => {
    if (endsRuby(code) || ends(code)) {
      return nok(code);
    }
    if (
      code === codes.verticalBar &&
      size > 0 &&
      previous !== codes.backslash &&
      previous !== codes.verticalBar
    ) {
      effects.exit(types.chunk);
      effects.exit(types.base);
      effects.enter(types.marker);
      effects.consume(code);
      effects.exit(types.marker);
      return textStart;
    }
    if (code !== codes.virtualSpace) {
      previous = code;
      size++;
    }
    effects.consume(code);
    return base;
  };

  const textStart: State = (code) => {
    if (endsRuby(code) || ends(code)) {
      return nok(code);
    }
    effects.enter(types.text);
    effects.consume(code);
    return text;
  };

  const text: State = (code) => {
    if (endsRuby(code) || ends(code)) {
      return nok(code);
    }
    if (code === codes.rightCurlyBrace) {
      effects.exit(types.text);
      effects.enter(types.marker);
      effects.consume(code);
      effects.exit(types.marker);
      effects.exit(types.ruby);
      return ok;
    }
    effects.consume(code);
    return text;
  };

  return start;
}

const rubyFromMarkdown: FromMarkdownExtension = {
  enter: {
    [types.ruby](token) {
      enterNode(this, { type: 'ruby', rubyText: '', children: [] }, token);
    },
  },
  exit: {
    [types.text](token) {
      currentNode(this).rubyText = this.sliceSerialize(token);
    },
    [types.ruby](token) {
      this.exit(token);
    },
  },
};

/**
 * Ruby text that `{base|ruby}` can hold: VFM ends it at the first `}` after
 * its first character, and on the line.
 */
export function isWritableRubyText(text: string): boolean {
  return /^[^\n\r\u2028\u2029][^}\n\r\u2028\u2029]*$/.test(text);
}

/**
 * Gives every ruby text of pasted HTML a ruby of its own, as in
 * `<ruby>日<rt>に</rt>本<rt>ほん</rt></ruby>`: a ruby node has one.
 */
function splitRubies(html: string): string {
  if (typeof DOMParser === 'undefined' || !/<rt[\s>]/i.test(html)) {
    return html;
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const ruby of document.querySelectorAll('ruby')) {
    if (ruby.querySelectorAll(':scope > rt').length < 2) {
      continue;
    }
    const parts: globalThis.Node[] = [];
    let current = document.createElement('ruby');
    for (const child of [...ruby.childNodes]) {
      if (child.nodeName === 'RP') {
        continue;
      }
      current.append(child);
      if (child.nodeName === 'RT') {
        parts.push(current);
        current = document.createElement('ruby');
      }
    }
    parts.push(...current.childNodes);
    ruby.replaceWith(...parts);
  }
  return document.body.innerHTML;
}

export const Ruby = Node.create({
  name: 'ruby',
  group: 'inline',
  inline: true,
  content: 'inline*',

  addAttributes() {
    return {
      rubyText: {
        default: '',
        parseHTML: (element) => element.querySelector('rt')?.textContent ?? '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'ruby',
        // Without ruby text there is no ruby to write.
        getAttrs: (element) => {
          const text = element.querySelector('rt')?.textContent ?? '';
          return isWritableRubyText(text) ? null : false;
        },
        contentElement: (element) => {
          const base = element.cloneNode(true) as HTMLElement;
          for (const annotation of base.querySelectorAll('rt, rp')) {
            annotation.remove();
          }
          return base;
        },
      },
    ];
  },

  // The base sits in a span of its own: the content of a node view has to be
  // a single element, and the ruby text follows it.
  renderHTML({ node, HTMLAttributes }) {
    return [
      'ruby',
      HTMLAttributes,
      ['span', 0],
      ['rt', { contenteditable: 'false' }, String(node.attrs.rubyText ?? '')],
    ];
  },

  addCommands() {
    return {
      setRuby:
        (rubyText) =>
        ({ editor, state, tr, dispatch }) => {
          if (!hasDocumentNotation(editor, this.name)) {
            return false;
          }
          if (!isWritableRubyText(rubyText)) {
            return false;
          }
          const found = findSelectedInline(state, this.name);
          if (found) {
            dispatch?.(
              tr.setNodeMarkup(found.pos, undefined, {
                ...found.node.attrs,
                rubyText,
              }),
            );
            return true;
          }
          if (
            followsAttributable(
              state,
              state.selection.from,
              sharedMarks(
                state.doc.slice(state.selection.from, state.selection.to)
                  .content,
              ),
            )
          ) {
            return false;
          }
          return wrapSelection(state, tr, this.type, { rubyText }, !!dispatch, {
            oneLine: true,
            unmarked: ['code'],
          });
        },
      insertRuby:
        ({ base, rubyText }) =>
        ({ editor, state, tr, dispatch }) => {
          if (
            !hasDocumentNotation(editor, this.name) ||
            !base ||
            /[\n\r]/.test(base) ||
            !isWritableRubyText(rubyText) ||
            followsAttributable(
              state,
              state.selection.from,
              state.selection.$from.marks(),
            )
          ) {
            return false;
          }
          return insertInline(
            state,
            tr,
            this.type.create({ rubyText }, state.schema.text(base)),
            !!dispatch,
            ['code'],
          );
        },
      unsetRuby:
        () =>
        ({ editor, state, tr, dispatch }) => {
          if (!hasDocumentNotation(editor, this.name)) {
            return false;
          }
          const found = findSelectedInline(state, this.name);
          if (!found) {
            return false;
          }
          dispatch?.(unwrap(tr, found));
          return true;
        },
    };
  },

  addInputRules() {
    return [rubyRules(() => hasDocumentNotation(this.editor, 'ruby')).input];
  },

  addPasteRules() {
    return [rubyRules(() => hasDocumentNotation(this.editor, 'ruby')).paste];
  },

  // A ruby without a base has no markdown, so it goes with its last
  // character; one whose base takes a line break is left as its base; and
  // code cannot hold a ruby.
  addProseMirrorPlugins() {
    return [
      inlineNodeRules(this.name, {
        marks: ['code'],
        needsContent: true,
        oneLine: true,
      }),
      new Plugin({ props: { transformPastedHTML: splitRubies } }),
    ];
  },
});

/**
 * Whether a link or code span ends right before `pos` without going on into
 * what is put there: VFM reads `{…}` after one as its attributes, and no
 * markdown keeps a ruby apart from it.
 */
function followsAttributable(
  state: EditorState,
  pos: number,
  marks: readonly Mark[],
): boolean {
  const before = state.doc.resolve(pos).nodeBefore;
  return Boolean(
    before?.marks.some(
      (mark) =>
        (mark.type.name === 'link' || mark.type.name === 'code') &&
        !mark.isInSet(marks),
    ),
  );
}

const rubyRules = (enabled: () => boolean) =>
  inlineSourceRules({
    enabled,
    find: /(?<!\\)\{((?:[^{}|\n\\]|\\[^\n])*[^{}|\n\\])\|([^{}\n]+)\}$/,
    build: ({ state, from, match, content }) => {
      const [, base, text] = match;
      if (
        base === undefined ||
        text === undefined ||
        followsAttributable(state, from, state.doc.nodeAt(from)?.marks ?? [])
      ) {
        return null;
      }
      return (
        state.schema.nodes.ruby?.create(
          { rubyText: text },
          unescapePipes(content(1, 1 + base.length)),
        ) ?? null
      );
    },
  });

function unescapePipes(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    nodes.push(
      node.isText && node.text?.includes('\\|')
        ? node.type.schema.text(node.text.replaceAll('\\|', '|'), node.marks)
        : node,
    );
  });
  return Fragment.from(nodes);
}

export const rubyNotation = defineNotation({
  name: 'ruby',
  version: 1,
  extensions: [Ruby],
  remarkPlugins: [
    syntaxPlugin(
      {
        text: {
          [codes.leftCurlyBrace]: { name: 'vfmRuby', tokenize: tokenizeRuby },
        },
      },
      rubyFromMarkdown,
    ),
  ],
  fromMarkdown: {
    ruby: (node, context) =>
      context.schema.nodes.ruby?.create(
        { rubyText: (node as RubyMdast).rubyText },
        context.inlines(node, []),
        context.marks,
      ),
  },
  nodes: {
    ruby: (node, context) =>
      `{${context.inline(node, { singleLine: true })}|${String(node.attrs.rubyText ?? '')}}`,
  },
  escapes: [
    { pattern: /\{/g },
    // The base cannot end with `|`, escaped or not, so a character reference
    // stands for it.
    { pattern: /\|(?=\n)/g, entity: true },
  ],
});
