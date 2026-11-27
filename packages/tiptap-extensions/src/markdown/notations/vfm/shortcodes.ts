import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import { codes } from 'micromark-util-symbol';
import type {
  Code,
  Construct,
  Effects,
  State,
  TokenizeContext,
} from 'micromark-util-types';

import {
  enterNode,
  isLineEnding,
  syntaxPlugin,
  tokenType,
} from '../../micromark';
import { defineNotation } from '../../notation';

const types = {
  shortcode: tokenType('vfmShortcode'),
  space: tokenType('vfmShortcodeSpace'),
  rest: tokenType('vfmShortcodeRest'),
  text: tokenType('chunkText'),
};

function isSpace(code: Code): boolean {
  return (
    code === codes.space ||
    code === codes.horizontalTab ||
    code === codes.virtualSpace
  );
}

/**
 * `[[identifier …]]` at the start of a line, as VFM 2 reads a shortcode:
 * not after indentation or interrupting a paragraph, and not blank. What
 * follows on the line is a paragraph of its own, as VFM 2 has it; VFM 2
 * also reads one up to `]]` on a later line, which is left out here.
 */
function tokenizeShortcode(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  let blank = true;

  const rest: State = (code) => {
    if (code === null || isLineEnding(code)) {
      effects.exit(types.text);
      effects.exit(types.rest);
      return ok(code);
    }
    effects.consume(code);
    return rest;
  };

  const after: State = (code: Code) => {
    if (code === null || isLineEnding(code)) {
      return ok(code);
    }
    if (isSpace(code)) {
      effects.enter(types.space);
      effects.consume(code);
      effects.exit(types.space);
      return after;
    }
    effects.enter(types.rest);
    effects.enter(types.text, { contentType: 'text' });
    return rest(code);
  };

  const closing: State = (code) => {
    if (code === codes.rightSquareBracket) {
      if (blank) {
        return nok(code);
      }
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
    if (code !== codes.rightSquareBracket && !isSpace(code)) {
      blank = false;
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
      enterNode(this, { type: 'shortcode' }, token);
    },
    [types.rest](token) {
      enterNode(this, { type: 'paragraph', children: [] }, token);
    },
  },
  exit: {
    [types.shortcode](token) {
      this.exit(token);
    },
    [types.rest](token) {
      this.exit(token);
    },
  },
};

// VFM removes every shortcode but `[[toc]]`, for which it writes an empty
// element. No definition handles them, so they are kept as written, and text
// that would read as one is escaped.
export const shortcodeNotation = defineNotation({
  name: 'shortcode',
  version: 1,
  remarkPlugins: [
    syntaxPlugin(
      { flow: { [codes.leftSquareBracket]: shortcode } },
      shortcodeFromMarkdown,
    ),
  ],
});
