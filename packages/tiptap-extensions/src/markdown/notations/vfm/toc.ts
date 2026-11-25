import { InputRule, Node } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

import { hasDocumentNotation } from '../../extension';
import type { UnknownMdastNode } from '../../mdast';
import {
  type Code,
  type Construct,
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

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** Inserts `[[toc]]` in place of the selection. */
      insertTableOfContents: () => ReturnType;
    };
  }
}

const types = {
  shortcode: tokenType('vfmShortcode'),
  space: tokenType('vfmShortcodeSpace'),
};

interface ShortcodeMdast extends UnknownMdastNode {
  identifier: string;
}

/**
 * `[[identifier …]]` alone on a line, as VFM 2 reads a shortcode: at the
 * start of the line, not interrupting a paragraph. VFM 2 also reads one
 * that text follows on its line, which is left out here.
 */
function tokenizeShortcode(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const after: State = (code: Code) => {
    if (code === null || isLineEnding(code)) {
      return ok(code);
    }
    if (
      code === codes.space ||
      code === codes.horizontalTab ||
      code === codes.virtualSpace
    ) {
      effects.enter(types.space);
      effects.consume(code);
      effects.exit(types.space);
      return after;
    }
    return nok(code);
  };

  const closing: State = (code) => {
    if (code === codes.rightSquareBracket) {
      effects.consume(code);
      effects.exit(types.shortcode);
      return after;
    }
    return inside(code);
  };

  const inside: State = (code) => {
    if (code === null || isLineEnding(code)) {
      return nok(code);
    }
    effects.consume(code);
    return code === codes.rightSquareBracket ? closing : inside;
  };

  return (code) => {
    const last = this.events.at(-1);
    // VFM 2 reads no shortcode after indentation.
    const indented =
      last?.[0] === 'exit' && (last[1].type as string) === 'linePrefix';
    if (code !== codes.leftSquareBracket || this.interrupt || indented) {
      return nok(code);
    }
    effects.enter(types.shortcode);
    effects.consume(code);
    return (second) => {
      if (second !== codes.leftSquareBracket) {
        return nok(second);
      }
      effects.consume(second);
      return inside;
    };
  };
}

const shortcode: Construct = {
  name: 'vfmShortcode',
  tokenize: tokenizeShortcode,
};

const shortcodeFromMarkdown: FromMarkdownExtension = {
  enter: {
    [types.shortcode](token) {
      enterNode(this, { type: 'shortcode', identifier: '' }, token);
    },
  },
  exit: {
    [types.shortcode](token) {
      const inner = this.sliceSerialize(token).slice(2, -2).trim();
      currentNode(this).identifier = inner.split(/\s+/)[0] ?? '';
      this.exit(token);
    },
  },
};

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,

  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },

  renderText() {
    return '[[toc]]';
  },

  // VFM writes an empty element where the table goes; the attribute only
  // lets the editor show it.
  renderHTML() {
    return ['div', { 'data-toc': '' }];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ editor, commands }) =>
          hasDocumentNotation(editor, this.name) &&
          commands.insertContent({ type: this.name }),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\[\[toc\]\]$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const { paragraph } = state.schema.nodes;
          const parent = $from.node(-1);
          const index = $from.index(-1);
          if (
            !paragraph ||
            !hasDocumentNotation(this.editor, this.name) ||
            $from.parent.type !== paragraph ||
            $from.parentOffset !== 0 ||
            range.to !== $from.end() ||
            !parent.canReplace(
              index,
              index + 1,
              Fragment.from([this.type.create(), paragraph.create()]),
            )
          ) {
            return null;
          }
          const { tr } = state;
          const start = $from.before();
          tr.replaceWith(start, $from.after(), [
            this.type.create(),
            paragraph.create(),
          ]);
          tr.setSelection(TextSelection.create(tr.doc, start + 2));
        },
      }),
    ];
  },
});

export const tableOfContentsNotation = defineNotation({
  name: 'tableOfContents',
  version: 1,
  extensions: [TableOfContents],
  remarkPlugins: [
    syntaxPlugin(
      { flow: { [codes.leftSquareBracket]: shortcode } },
      shortcodeFromMarkdown,
    ),
  ],
  fromMarkdown: {
    // VFM removes other shortcodes, which are kept as written.
    shortcode: (node, context) =>
      (node as ShortcodeMdast).identifier === 'toc'
        ? context.schema.nodes.tableOfContents?.create()
        : undefined,
  },
  nodes: {
    tableOfContents: () => '[[toc]]',
  },
});
