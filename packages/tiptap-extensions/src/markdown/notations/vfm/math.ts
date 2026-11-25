import { Node } from '@tiptap/core';

import { hasDocumentNotation } from '../../extension';
import type { UnknownMdastNode } from '../../mdast';
import {
  type Construct,
  codes,
  currentNode,
  type Effects,
  enterNode,
  type FromMarkdownExtension,
  isDigit,
  isJsWhitespace,
  isLineEnding,
  OpenDelimiters,
  type Resolver,
  type State,
  syntaxPlugin,
  type TokenizeContext,
  tokenType,
} from '../../micromark';
import { defineNotation } from '../../notation';
import { findSelectedInline, insertInline } from './commands';
import { inlineSourceRules } from './input-rules';
import { inlineNodeRules } from './normalize';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      /** Changes the selected math, or inserts math in place of the selection. */
      setMath: (attrs: { latex: string; display: boolean }) => ReturnType;
    };
  }
}

const types = {
  inline: tokenType('vfmMathInline'),
  display: tokenType('vfmMathDisplay'),
  marker: tokenType('vfmMathMarker'),
  value: tokenType('vfmMathValue'),
  // Not `lineEnding`: markdown would read the spaces before it as a hard
  // break, and its mdast handler would leave it out of the value.
  lineEnding: tokenType('vfmMathLineEnding'),
};

interface MathMdast extends UnknownMdastNode {
  value: string;
}

/** A closing `$` of inline math, which no `$` or digit may follow. */
const inlineClosing: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return (code) => {
      effects.enter(types.marker);
      effects.consume(code);
      effects.exit(types.marker);
      return (after) =>
        after === codes.dollarSign || isDigit(after) ? nok(after) : ok(after);
    };
  },
};

/** A closing `$$` of display math, which no `$` may follow. */
const displayClosing: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return (code) => {
      effects.enter(types.marker);
      effects.consume(code);
      return (second) => {
        if (second !== codes.dollarSign) {
          return nok(second);
        }
        effects.consume(second);
        effects.exit(types.marker);
        return (after) => (after === codes.dollarSign ? nok(after) : ok(after));
      };
    };
  },
};

/**
 * `$…$` or `$$…$$` as VFM 2 reads them: the value runs to the first `$`
 * that can close it, across the lines of the paragraph. Inline math cannot
 * start with whitespace, end with whitespace or an unescaped backslash, or be
 * followed by a digit.
 */
function mathTokenizer(display: boolean) {
  const group = display ? types.display : types.inline;
  return function tokenize(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    const open = new OpenDelimiters(this);
    let inValue = false;
    // What the value ends with decides whether a `$` can close it.
    let backslashes = 0;
    let closable = false;
    let lastIsDollar = false;

    const closeValue = () => {
      if (inValue) {
        effects.exit(types.value);
        inValue = false;
      }
    };

    const value: State = (code) => {
      if (code === null) {
        return nok(code);
      }
      if (isLineEnding(code)) {
        if (open.ends(code)) {
          return nok(code);
        }
        closeValue();
        effects.enter(types.lineEnding);
        effects.consume(code);
        effects.exit(types.lineEnding);
        backslashes = 0;
        closable = false;
        lastIsDollar = false;
        return value;
      }
      if (code === codes.dollarSign) {
        const canClose = display
          ? !lastIsDollar
          : backslashes === 0
            ? closable
            : backslashes % 2 === 0;
        if (canClose) {
          return effects.check(
            display ? displayClosing : inlineClosing,
            closing,
            content,
          )(code);
        }
      }
      return content(code);
    };

    const content: State = (code) => {
      if (open.ends(code)) {
        return nok(code);
      }
      if (!inValue) {
        effects.enter(types.value);
        inValue = true;
      }
      effects.consume(code);
      if (code !== codes.virtualSpace) {
        lastIsDollar = code === codes.dollarSign;
        if (code === codes.backslash) {
          backslashes++;
        } else {
          backslashes = 0;
          closable = !lastIsDollar && !isJsWhitespace(code);
        }
      }
      return value;
    };

    const closing: State = (code) => {
      if (open.endsBefore(code)) {
        return nok(code);
      }
      closeValue();
      effects.enter(types.marker);
      effects.consume(code);
      if (!display) {
        effects.exit(types.marker);
        effects.exit(group);
        return ok;
      }
      return (second) => {
        effects.consume(second);
        effects.exit(types.marker);
        effects.exit(group);
        return ok;
      };
    };

    const first: State = (code) => {
      if (
        code === null ||
        code === codes.dollarSign ||
        (!display && isJsWhitespace(code))
      ) {
        return nok(code);
      }
      effects.exit(types.marker);
      return value(code);
    };

    return (code) => {
      if (code !== codes.dollarSign) {
        return nok(code);
      }
      effects.enter(group);
      effects.enter(types.marker);
      effects.consume(code);
      if (!display) {
        return first;
      }
      return (second) => {
        if (second !== codes.dollarSign) {
          return nok(second);
        }
        effects.consume(second);
        return first;
      };
    };
  };
}

// VFM 2 reads no math in the text of a link, so what is there stays text.
// The events are changed in place: micromark keeps the array it gave.
const resolveMathInLinks: Resolver = (events) => {
  let depth = 0;
  for (let index = 0; index < events.length; index++) {
    const [kind, token] = events[index];
    const type = token.type as string;
    if (type === 'link' || type === 'image') {
      depth += kind === 'enter' ? 1 : -1;
    } else if (depth > 0) {
      if (type === types.inline || type === types.display) {
        events.splice(index, 1);
        index--;
      } else if (type === types.marker || type === types.value) {
        token.type = tokenType('data');
      } else if (type === types.lineEnding) {
        token.type = tokenType('lineEnding');
      }
    }
  }
  return events;
};

const mathFromMarkdown: FromMarkdownExtension = {
  enter: {
    [types.inline](token) {
      enterNode(this, { type: 'inlineMath', value: '' }, token);
    },
    [types.display](token) {
      enterNode(this, { type: 'displayMath', value: '' }, token);
    },
  },
  exit: {
    [types.value](token) {
      currentNode(this).value += this.sliceSerialize(token);
    },
    [types.lineEnding](token) {
      currentNode(this).value += this.sliceSerialize(token);
    },
    [types.inline](token) {
      this.exit(token);
    },
    [types.display](token) {
      this.exit(token);
    },
  },
};

/**
 * Where inline math that starts at `text[0]` ends, i.e. the index of its
 * closing `$`, or -1. A digit right after `text` counts as following it.
 */
function closingOf(text: string, display: boolean): number {
  const open = display ? 2 : 1;
  if (
    !text.startsWith(display ? '$$' : '$') ||
    text[open] === undefined ||
    text[open] === '$' ||
    (!display && /\s/.test(text[open]))
  ) {
    return -1;
  }
  let backslashes = 0;
  let closable = false;
  let lastIsDollar = false;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (char === '$' && index > open) {
      const canClose = display
        ? !lastIsDollar
        : backslashes === 0
          ? closable
          : backslashes % 2 === 0;
      const after = display ? text[index + 2] : text[index + 1];
      if (
        canClose &&
        (!display || text[index + 1] === '$') &&
        after !== '$' &&
        !(!display && after !== undefined && /\d/.test(after))
      ) {
        return index;
      }
    }
    lastIsDollar = char === '$';
    if (char === '\\') {
      backslashes++;
    } else {
      backslashes = 0;
      closable = !lastIsDollar && !/\s/.test(char);
    }
  }
  return -1;
}

/**
 * Whether `$latex$` (or `$$latex$$`) reads back as math holding `latex`.
 * Line breaks are left to the caller: a blank line or a line that starts a
 * block would end the paragraph.
 */
export function isWritableMath(latex: string, display: boolean): boolean {
  const fence = display ? '$$' : '$';
  return (
    latex.length > 0 &&
    !/\n[ \t]*\n/.test(latex) &&
    closingOf(`${fence}${latex}${fence}`, display) ===
      latex.length + fence.length
  );
}

/** The LaTeX of math as VFM renders it for MathJax. */
function mathSource(text: string): string {
  return (
    text.match(/^\\\(([\s\S]*)\\\)$/)?.[1] ??
    text.match(/^\$\$([\s\S]*)\$\$$/)?.[1] ??
    text
  );
}

export const MathNode = Node.create({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => mathSource(element.textContent ?? ''),
        renderHTML: () => ({}),
      },
      display: {
        default: false,
        parseHTML: (element) => element.classList.contains('display'),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span.math[data-math-typeset]',
        getAttrs: (element) =>
          isWritableMath(
            mathSource(element.textContent ?? ''),
            element.classList.contains('display'),
          )
            ? null
            : false,
      },
    ];
  },

  // As VFM renders it for MathJax, which the editor does not run, so the
  // source is what shows.
  renderHTML({ node, HTMLAttributes }) {
    const latex = String(node.attrs.latex ?? '');
    return node.attrs.display
      ? [
          'span',
          {
            ...HTMLAttributes,
            class: 'math display',
            'data-math-typeset': 'true',
          },
          `$$${latex}$$`,
        ]
      : [
          'span',
          {
            ...HTMLAttributes,
            class: 'math inline',
            'data-math-typeset': 'true',
          },
          `\\(${latex}\\)`,
        ];
  },

  renderText({ node }) {
    const fence = node.attrs.display ? '$$' : '$';
    return `${fence}${String(node.attrs.latex ?? '')}${fence}`;
  },

  addCommands() {
    return {
      setMath:
        (attrs) =>
        ({ editor, state, tr, dispatch }) => {
          if (!hasDocumentNotation(editor, this.name)) {
            return false;
          }
          if (!isWritableMath(attrs.latex, attrs.display)) {
            return false;
          }
          const found = findSelectedInline(state, this.name);
          if (found) {
            dispatch?.(tr.setNodeMarkup(found.pos, undefined, attrs));
            return true;
          }
          return insertInline(state, tr, this.type.create(attrs), !!dispatch, [
            'code',
            'link',
          ]);
        },
    };
  },

  // VFM reads no math in code or in a link.
  addProseMirrorPlugins() {
    return [inlineNodeRules(this.name, { marks: ['code', 'link'] })];
  },

  addInputRules() {
    const enabled = () => hasDocumentNotation(this.editor, 'math');
    return [mathRules(false, enabled).input, mathRules(true, enabled).input];
  },

  addPasteRules() {
    const enabled = () => hasDocumentNotation(this.editor, 'math');
    return [mathRules(true, enabled).paste, mathRules(false, enabled).paste];
  },
});

// The content: no `$` inside, so the last of several on the line is the one
// closed. A digit after the closing `$` keeps it from closing, so the rule
// waits for the character after it.
const INLINE =
  '(?<![$\\\\])\\$((?:[^$\\s\\\\]|\\\\[^\\n])(?:(?:[^$\\n\\\\]|\\\\[^\\n])*(?:[^$\\s\\\\]|\\\\[^\\n]))?)\\$';
const DISPLAY = '(?<![$\\\\])\\$\\$((?:[^$\\n\\\\]|\\\\[^\\n])+)\\$\\$';

function mathRules(display: boolean, enabled: () => boolean) {
  const source = display ? DISPLAY : INLINE;
  return inlineSourceRules({
    find: new RegExp(`${source}(?<after>[^\\d$])$`),
    paste: new RegExp(`${source}(?![\\d$])`, 'g'),
    build: ({ state, match }) => {
      const latex = match[1];
      if (latex === undefined || !isWritableMath(latex, display)) {
        return null;
      }
      return state.schema.nodes.math?.create({ latex, display }) ?? null;
    },
    enabled,
  });
}

export const mathNotation = defineNotation({
  name: 'math',
  version: 1,
  extensions: [MathNode],
  remarkPlugins: [
    syntaxPlugin(
      {
        text: {
          [codes.dollarSign]: [
            {
              name: 'vfmMathDisplay',
              tokenize: mathTokenizer(true),
              resolveAll: resolveMathInLinks,
            },
            {
              name: 'vfmMathInline',
              tokenize: mathTokenizer(false),
              resolveAll: resolveMathInLinks,
            },
          ],
        },
      },
      mathFromMarkdown,
    ),
  ],
  fromMarkdown: {
    inlineMath: (node, context) =>
      context.schema.nodes.math?.create(
        { latex: (node as MathMdast).value, display: false },
        null,
        context.marks,
      ),
    displayMath: (node, context) =>
      context.schema.nodes.math?.create(
        { latex: (node as MathMdast).value, display: true },
        null,
        context.marks,
      ),
  },
  nodes: {
    math: (node) => {
      const fence = node.attrs.display ? '$$' : '$';
      return `${fence}${String(node.attrs.latex ?? '')}${fence}`;
    },
  },
  escapes: [
    { pattern: /\$/g },
    // A digit right after inline math would keep it from closing.
    { pattern: /(?<=\$)\d/g, entity: true },
  ],
});
