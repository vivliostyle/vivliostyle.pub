import { Node } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';

import type { UnknownMdastNode } from '../../mdast';
import {
  type Code,
  codes,
  currentNode,
  type Effects,
  enterNode,
  type FromMarkdownExtension,
  isLineEnding,
  type State,
  syntaxPlugin,
  type TokenizeContext,
  tokenType,
} from '../../micromark';
import { defineNotation } from '../../notation';
import { findSelectedInline, unwrap, wrapSelection } from './commands';
import { inlineSourceRules } from './input-rules';

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
  let previous: Code = null;
  let size = 0;

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
    if (endsRuby(code)) {
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
    if (endsRuby(code)) {
      return nok(code);
    }
    effects.enter(types.text);
    effects.consume(code);
    return text;
  };

  const text: State = (code) => {
    if (endsRuby(code)) {
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
        ({ state, tr, dispatch }) => {
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
          return wrapSelection(state, tr, this.type, { rubyText }, !!dispatch);
        },
      unsetRuby:
        () =>
        ({ state, tr, dispatch }) => {
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
    return [rubyRules.input];
  },

  addPasteRules() {
    return [rubyRules.paste];
  },

  // A ruby without a base has no markdown, so it goes with its last character.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _, state) => {
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }
          const empty: { from: number; to: number }[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.childCount === 0) {
              empty.push({ from: pos, to: pos + node.nodeSize });
            }
          });
          if (empty.length === 0) {
            return null;
          }
          const { tr } = state;
          for (const { from, to } of empty.toReversed()) {
            tr.delete(from, to);
          }
          return tr;
        },
      }),
    ];
  },
});

const rubyRules = inlineSourceRules({
  find: /(?<!\\)\{((?:[^{}|\n\\]|\\[^\n])*[^{}|\n\\])\|([^{}\n]+)\}$/,
  build: ({ state, match, content }) => {
    const [, base, text] = match;
    if (base === undefined || text === undefined) {
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
