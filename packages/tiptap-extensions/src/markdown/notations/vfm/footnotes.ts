import { Node } from '@tiptap/core';

import { hasDocumentNotation } from '../../extension';
import type { UnknownMdastNode } from '../../mdast';
import {
  type Code,
  type Construct,
  codes,
  currentNode,
  type Effects,
  endsOpen,
  enterNode,
  type FromMarkdownExtension,
  isLineEnding,
  openBefore,
  type State,
  syntaxPlugin,
  type Token,
  type TokenizeContext,
  tokenType,
} from '../../micromark';
import { defineNotation, type NotationDefinition } from '../../notation';
import {
  findSelectedInline,
  insertInline,
  unwrap,
  wrapSelection,
} from './commands';
import { inlineSourceRules } from './input-rules';
import { inlineNodeRules } from './normalize';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnoteReference: {
      /**
       * Changes the label of the selected reference, or inserts a reference
       * in place of the selection.
       */
      setFootnoteReference: (label: string) => ReturnType;
    };
    inlineFootnote: {
      /**
       * Makes a note of the selected text, or inserts a note holding `text`
       * where nothing is selected.
       */
      setInlineFootnote: (text?: string) => ReturnType;
      /** Leaves the content of the note the selection is in as text. */
      unsetInlineFootnote: () => ReturnType;
    };
  }
}

const types = {
  call: tokenType('vfmFootnoteCall'),
  callMarker: tokenType('vfmFootnoteCallMarker'),
  callLabel: tokenType('vfmFootnoteCallLabel'),
  note: tokenType('vfmInlineFootnote'),
  noteMarker: tokenType('vfmInlineFootnoteMarker'),
  chunk: tokenType('chunkText'),
};

interface ReferenceMdast extends UnknownMdastNode {
  label?: string;
}

function isLabelCode(code: Code): boolean {
  return code !== null && code >= 0 && code !== codes.space;
}

/**
 * A `(` that a `)` on the line closes, which makes the brackets before it a
 * link with VFM 2.
 */
const resourceAhead: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    const inside: State = (code) => {
      if (code === null || isLineEnding(code)) {
        return nok(code);
      }
      effects.consume(code);
      return code === codes.rightParenthesis ? ok : inside;
    };
    return (code) => {
      effects.enter(types.callMarker);
      effects.consume(code);
      return inside;
    };
  },
};

/** `![^label]`: VFM 2 reads the `!` as text before the reference. */
const callAfterBang: Construct = {
  name: 'vfmFootnoteCallAfterBang',
  tokenize(effects, ok, nok) {
    return (code) => {
      if (code !== codes.exclamationMark) {
        return nok(code);
      }
      effects.enter(tokenType('data'));
      effects.consume(code);
      effects.exit(tokenType('data'));
      return effects.attempt(
        { tokenize: tokenizeCall, partial: true },
        ok,
        nok,
      );
    };
  },
};

/**
 * `[^label]` as VFM 2 reads it, whether or not the label has a definition:
 * the label runs to the first `]` and has no whitespace. A `(` after it makes
 * the brackets a link instead.
 */
function tokenizeCall(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const label: State = (code) => {
    if (code === codes.rightSquareBracket) {
      effects.exit(types.callLabel);
      effects.enter(types.callMarker);
      effects.consume(code);
      effects.exit(types.callMarker);
      return after;
    }
    if (!isLabelCode(code)) {
      return nok(code);
    }
    effects.consume(code);
    return label;
  };

  const done: State = (code) => {
    effects.exit(types.call);
    return ok(code);
  };

  const after: State = (code) =>
    code === codes.leftParenthesis
      ? effects.check(resourceAhead, nok, done)(code)
      : done(code);

  return (code) => {
    if (code !== codes.leftSquareBracket) {
      return nok(code);
    }
    effects.enter(types.call);
    effects.enter(types.callMarker);
    effects.consume(code);
    return (caret) => {
      if (caret !== codes.caret) {
        return nok(caret);
      }
      effects.consume(caret);
      effects.exit(types.callMarker);
      return (first) => {
        if (!isLabelCode(first) || first === codes.rightSquareBracket) {
          return nok(first);
        }
        effects.enter(types.callLabel);
        return label(first);
      };
    };
  };
}

/**
 * `^[note]` as VFM 2 reads it: the note runs to the `]` that balances its
 * `[`, skipping escaped characters and code spans, and may span the lines of
 * the paragraph. It is read as inline markdown on its own.
 */
function inlineFootnoteTokenizer(allowEmpty: boolean) {
  return function tokenize(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    // A link's label is not ended by brackets the note balances.
    const open = { ...openBefore(this), label: false };
    let last: Code = null;
    let balance = 0;
    let escaped = false;
    let run = 0;
    let fence = 0;
    let chunk: Token | undefined;
    let previous: Token | undefined;
    let size = 0;

    // A line's chunk starts at its first character, which is where micromark
    // knows the position in its buffer.
    const openChunk = () => {
      if (chunk) {
        return;
      }
      chunk = effects.enter(types.chunk, { contentType: 'text', previous });
      if (previous) {
        previous.next = chunk;
      }
    };

    // A run of backticks opens a code span, or closes the open one when it
    // is as long, once it is known where the run ends.
    const endRun = () => {
      if (run === 0) {
        return;
      }
      if (fence === 0) {
        fence = run;
      } else if (run === fence) {
        fence = 0;
      }
      run = 0;
    };

    const content: State = (code) => {
      if (code === null || endsOpen(open, code, last)) {
        return nok(code);
      }
      last = code;
      if (code === codes.graveAccent && !escaped) {
        run++;
        openChunk();
        effects.consume(code);
        size++;
        return content;
      }
      endRun();
      if (isLineEnding(code)) {
        openChunk();
        effects.consume(code);
        previous = effects.exit(types.chunk);
        chunk = undefined;
        escaped = false;
        size++;
        return content;
      }
      if (
        fence === 0 &&
        !escaped &&
        code === codes.rightSquareBracket &&
        balance === 0
      ) {
        if (size === 0 && !allowEmpty) {
          return nok(code);
        }
        if (chunk) {
          effects.exit(types.chunk);
        }
        effects.enter(types.noteMarker);
        effects.consume(code);
        effects.exit(types.noteMarker);
        effects.exit(types.note);
        return ok;
      }
      if (fence === 0 && !escaped) {
        if (code === codes.backslash) {
          escaped = true;
        } else if (code === codes.leftSquareBracket) {
          balance++;
        } else if (code === codes.rightSquareBracket) {
          balance--;
        }
      } else if (code !== codes.virtualSpace) {
        escaped = false;
      }
      openChunk();
      effects.consume(code);
      size++;
      return content;
    };

    return (code) => {
      if (code !== codes.caret) {
        return nok(code);
      }
      effects.enter(types.note);
      effects.enter(types.noteMarker);
      effects.consume(code);
      return (bracket) => {
        if (bracket !== codes.leftSquareBracket) {
          return nok(bracket);
        }
        effects.consume(bracket);
        effects.exit(types.noteMarker);
        return content;
      };
    };
  };
}

const callFromMarkdown: FromMarkdownExtension = {
  enter: {
    [types.call](token) {
      enterNode(
        this,
        { type: 'footnoteReference', identifier: '', label: '' },
        token,
      );
    },
  },
  exit: {
    [types.callLabel](token) {
      const label = this.sliceSerialize(token);
      const node = currentNode(this);
      node.label = label;
      node.identifier = label.toLowerCase();
    },
    [types.call](token) {
      this.exit(token);
    },
  },
};

const noteFromMarkdown: FromMarkdownExtension = {
  canContainEols: ['footnote'],
  enter: {
    [types.note](token) {
      enterNode(this, { type: 'footnote', children: [] }, token);
    },
  },
  exit: {
    [types.note](token) {
      this.exit(token);
    },
  },
};

/** A label that `[^label]` can hold. */
export function isWritableFootnoteLabel(label: string): boolean {
  return /^[^\s\]]+$/.test(label);
}

export const FootnoteReference = Node.create({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.textContent ?? '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    // Before links, which an `a` with an `href` is otherwise.
    return [
      {
        tag: 'a.footnote-ref',
        priority: 60,
        getAttrs: (element) =>
          isWritableFootnoteLabel(element.textContent ?? '') ? null : false,
      },
    ];
  },

  // As VFM's default footnote mode renders a reference, but with the label in
  // place of the number it gets from its position in the book.
  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label ?? '');
    return [
      'a',
      {
        ...HTMLAttributes,
        id: `fnref${label}`,
        href: `#fn${label}`,
        class: 'footnote-ref',
        role: 'doc-noteref',
      },
      ['sup', label],
    ];
  },

  renderText({ node }) {
    return `[^${String(node.attrs.label ?? '')}]`;
  },

  addCommands() {
    return {
      setFootnoteReference:
        (label) =>
        ({ editor, state, tr, dispatch }) => {
          if (!hasDocumentNotation(editor, this.name)) {
            return false;
          }
          if (!isWritableFootnoteLabel(label)) {
            return false;
          }
          const found = findSelectedInline(state, this.name);
          if (found) {
            dispatch?.(tr.setNodeMarkup(found.pos, undefined, { label }));
            return true;
          }
          return insertInline(
            state,
            tr,
            this.type.create({ label }),
            !!dispatch,
            ['code'],
          );
        },
    };
  },

  addProseMirrorPlugins() {
    return [inlineNodeRules(this.name, { marks: ['code'] })];
  },

  addInputRules() {
    const enabled = () => hasDocumentNotation(this.editor, this.name);
    return [
      referenceRules(enabled).input,
      blockStartReferenceRules(enabled).input,
    ];
  },

  addPasteRules() {
    return [
      referenceRules(() => hasDocumentNotation(this.editor, this.name)).paste,
    ];
  },
});

const referenceRules = (enabled: () => boolean) =>
  inlineSourceRules({
    enabled,
    find: /(?<!\\)\[\^([^\s\]]+)\]$/,
    build: ({ state, from, match }) =>
      // At the start of a block it may begin the note's definition, which
      // the `:` after it tells.
      match[1] && state.doc.resolve(from).parentOffset > 0
        ? (state.schema.nodes.footnoteReference?.create({
            label: match[1],
          }) ?? null)
        : null,
  });

const blockStartReferenceRules = (enabled: () => boolean) =>
  inlineSourceRules({
    enabled,
    find: /^\[\^([^\s\]]+)\](?<after>[^:])$/,
    build: ({ state, from, match }) =>
      match[1] && state.doc.resolve(from).parentOffset === 0
        ? (state.schema.nodes.footnoteReference?.create({
            label: match[1],
          }) ?? null)
        : null,
  });

export const InlineFootnote = Node.create({
  name: 'inlineFootnote',
  group: 'inline',
  inline: true,
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'span.footnote' }];
  },

  // As VFM's gcpm footnote mode renders it: the note stays where it is
  // written, which is also where it is edited.
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      { ...HTMLAttributes, class: 'footnote', role: 'doc-footnote' },
      0,
    ];
  },

  addCommands() {
    return {
      setInlineFootnote:
        (text) =>
        ({ editor, state, tr, dispatch }) => {
          if (!hasDocumentNotation(editor, this.name)) {
            return false;
          }
          if (findSelectedInline(state, this.name)) {
            return false;
          }
          if (!state.selection.empty) {
            return wrapSelection(state, tr, this.type, null, !!dispatch, {
              unmarked: ['code', 'link'],
            });
          }
          return insertInline(
            state,
            tr,
            this.type.create(null, text ? state.schema.text(text) : null),
            !!dispatch,
            ['code', 'link'],
          );
        },
      unsetInlineFootnote:
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

  // A note in a link would hold the link's end, and code cannot hold one.
  addProseMirrorPlugins() {
    return [inlineNodeRules(this.name, { marks: ['code', 'link'] })];
  },

  addInputRules() {
    return [noteRules(() => hasDocumentNotation(this.editor, this.name)).input];
  },

  addPasteRules() {
    return [noteRules(() => hasDocumentNotation(this.editor, this.name)).paste];
  },
});

const noteRules = (enabled: () => boolean) =>
  inlineSourceRules({
    enabled,
    find: /(?<!\\)\^\[([^[\]\n]+)\]$/,
    build: ({ state, match, content }) =>
      match[1]
        ? (state.schema.nodes.inlineFootnote?.create(
            null,
            content(2, 2 + match[1].length),
          ) ?? null)
        : null,
  });

export interface FootnoteOptions {
  /**
   * `[^label]` is a reference without a definition, as VFM 2 reads it. GFM,
   * and so VFM after it, reads it as text then.
   */
  undefinedReferences: boolean;
  /** `^[]` is an empty note, as VFM 2 reads it. */
  emptyInlineNotes: boolean;
}

export function footnoteNotations({
  undefinedReferences,
  emptyInlineNotes,
}: FootnoteOptions): NotationDefinition[] {
  return [
    defineNotation({
      name: 'footnoteReference',
      version: 1,
      extensions: [FootnoteReference],
      remarkPlugins: undefinedReferences
        ? [
            syntaxPlugin(
              {
                text: {
                  [codes.leftSquareBracket]: {
                    name: 'vfmFootnoteCall',
                    tokenize: tokenizeCall,
                  },
                  [codes.exclamationMark]: callAfterBang,
                },
              },
              callFromMarkdown,
            ),
          ]
        : [],
      fromMarkdown: {
        footnoteReference: (node, context) =>
          context.schema.nodes.footnoteReference?.create(
            {
              label:
                (node as ReferenceMdast).label ??
                (node as { identifier?: string }).identifier ??
                '',
            },
            null,
            context.marks,
          ),
      },
      nodes: {
        footnoteReference: (node) => `[^${String(node.attrs.label ?? '')}]`,
      },
      escapes: [
        // `(` right after a reference would make it a link. A backslash
        // would be kept as raw markdown, since `(` means nothing elsewhere.
        { pattern: /(?<=\])\(/g, entity: true },
        // `[^label]:` starting a line would define the note.
        { pattern: /(?<=\]):/g, entity: true },
      ],
    }),
    defineNotation({
      name: 'inlineFootnote',
      version: 1,
      extensions: [InlineFootnote],
      remarkPlugins: [
        syntaxPlugin(
          {
            text: {
              [codes.caret]: {
                name: 'vfmInlineFootnote',
                tokenize: inlineFootnoteTokenizer(emptyInlineNotes),
              },
            },
          },
          noteFromMarkdown,
        ),
      ],
      fromMarkdown: {
        footnote: (node, context) =>
          context.schema.nodes.inlineFootnote?.create(
            null,
            context.inlines(node, []),
            context.marks,
          ),
      },
      nodes: {
        inlineFootnote: (node, context) => `^[${context.inline(node)}]`,
      },
      escapes: [
        // A `^` before a link would open a note with it.
        // The writer stands for a delimiter after the text with `!`.
        { pattern: /\^(?=[[!])/g },
      ],
    }),
  ];
}
