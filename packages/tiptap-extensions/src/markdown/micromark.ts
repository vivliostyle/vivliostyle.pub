import type {
  CompileContext,
  Extension as FromMarkdownExtension,
} from 'mdast-util-from-markdown';
import { codes } from 'micromark-util-symbol';
import type {
  Code,
  Extension as MicromarkExtension,
  Token,
  TokenizeContext,
  TokenType,
} from 'micromark-util-types';
import type { Processor } from 'unified';

import type { UnknownMdastNode } from './mdast';

/** Token types of syntax extensions, which micromark's types do not list. */
export function tokenType(name: string): TokenType {
  return name as TokenType;
}

/** Enters an mdast node of a type the mdast types do not list. */
export function enterNode(
  context: CompileContext,
  node: UnknownMdastNode & Record<string, unknown>,
  token: Token,
): void {
  context.enter(
    node as unknown as Parameters<CompileContext['enter']>[0],
    token,
  );
}

/** The innermost open node, which an exit handler of its token finishes. */
export function currentNode(
  context: CompileContext,
): UnknownMdastNode & Record<string, unknown> {
  return context.stack[
    context.stack.length - 1
  ] as unknown as UnknownMdastNode & Record<string, unknown>;
}

/** A remark plugin adding a micromark and an mdast-util-from-markdown extension. */
export function syntaxPlugin(
  syntax: MicromarkExtension,
  fromMarkdown: FromMarkdownExtension,
) {
  return function (this: Processor) {
    const data = this.data();
    data.micromarkExtensions = [...(data.micromarkExtensions ?? []), syntax];
    data.fromMarkdownExtensions = [
      ...(data.fromMarkdownExtensions ?? []),
      fromMarkdown,
    ];
  };
}

export function isLineEnding(code: Code): boolean {
  return code !== null && code < codes.horizontalTab;
}

export function isDigit(code: Code): boolean {
  return code !== null && code >= 48 && code <= 57;
}

/** Whitespace as `\s` in a JavaScript regular expression matches it. */
export function isJsWhitespace(code: Code): boolean {
  if (code === null) {
    return false;
  }
  if (code < 0) {
    return true;
  }
  return /\s/.test(String.fromCharCode(code));
}

/** The character a code stands for; a tab's virtual spaces are none. */
export function charOf(code: Code): string {
  if (code === null || code === codes.virtualSpace) {
    return '';
  }
  if (code === codes.horizontalTab) {
    return '\t';
  }
  if (code < 0) {
    return '\n';
  }
  return String.fromCharCode(code);
}

// What `\w` matches, which is how VFM 2 tells that `_` is inside a word.
function isAsciiWord(code: Code): boolean {
  return code !== null && code >= 0 && /\w/.test(String.fromCharCode(code));
}

/**
 * Emphasis, strikethrough and a link's label open before the current
 * position, and whether what follows ends one of them as VFM 2 reads it.
 * VFM 2 finds where emphasis ends before it reads what is inside, so a
 * construct that would run past that end does not start where it is.
 *
 * VFM 2 ends `**` and `__` at the first run of two or more of their
 * character, and `*` and `_` at a single one: pairs are skipped, and `_`
 * before a letter or digit does not end it. A backslash takes the character
 * after it out of both. `~~` ends at a pair that whitespace does not come
 * before, escaped or not.
 */
export class OpenDelimiters {
  private readonly strong = new Set<number>();
  private readonly emphasis = new Set<number>();
  private readonly strikethrough: boolean;
  private readonly label: boolean;
  private escaped = false;
  private run: Code = null;
  private runLength = 0;
  private tildes = 0;
  private beforeTildes: Code = null;
  // Not whitespace: the construct's opening comes before its content.
  private last: Code = 0;

  constructor(context: TokenizeContext, { label = true } = {}) {
    const open = new Map<number, number[]>();
    const links = new Set<number>();
    for (const [kind, token] of context.events) {
      if (
        kind === 'enter' &&
        (token.type === 'link' || token.type === 'image')
      ) {
        links.add(token.start.offset);
      }
    }
    let labelOpen = false;
    for (const [kind, token] of context.events) {
      if (kind !== 'exit') {
        continue;
      }
      const type = token.type as string;
      if (
        type === 'attentionSequence' ||
        type === 'strikethroughSequenceTemporary'
      ) {
        const sequence = context.sliceSerialize(token);
        const marker = sequence.charCodeAt(0);
        const stack = open.get(marker) ?? [];
        open.set(marker, stack);
        if (token._close && stack.length > 0) {
          let length = sequence.length;
          while (length > 0 && stack.length > 0) {
            const top = stack.pop() as number;
            const used = Math.min(top, length);
            length -= used;
            if (top > used) {
              stack.push(top - used);
            }
          }
        } else if (token._open) {
          stack.push(sequence.length);
        }
      } else if (
        (type === 'labelLink' || type === 'labelImage') &&
        !token._balanced &&
        !token._inactive &&
        !links.has(token.start.offset)
      ) {
        labelOpen = true;
      }
    }
    for (const [marker, stack] of open) {
      for (const length of stack) {
        // VFM 2 opens `**` first, so a run of three holds `*` within it.
        if (length >= 2) {
          this.strong.add(marker);
        }
        if (length % 2 === 1) {
          this.emphasis.add(marker);
        }
      }
    }
    this.strikethrough =
      this.strong.has(codes.tilde) || this.emphasis.has(codes.tilde);
    this.label = label && labelOpen;
  }

  /** Whether `code`, the next character of the construct, ends any. */
  ends(code: Code): boolean {
    if (code === null || code === codes.virtualSpace) {
      return false;
    }
    const escaped = this.escaped;
    this.escaped = !escaped && code === codes.backslash;
    if (code === codes.tilde) {
      if (this.tildes === 0) {
        this.beforeTildes = this.last;
      }
      this.tildes++;
    } else {
      this.tildes = 0;
    }
    const marker =
      !escaped && (code === codes.asterisk || code === codes.underscore)
        ? code
        : null;
    let ended = false;
    if (marker !== null && marker === this.run) {
      this.runLength++;
    } else {
      ended = this.endsBefore(code);
      this.run = marker;
      this.runLength = marker === null ? 0 : 1;
    }
    this.last = code;
    return (
      ended ||
      (this.run !== null && this.runLength >= 2 && this.strong.has(this.run)) ||
      (this.strikethrough &&
        (this.tildes >= 3 ||
          (this.tildes === 2 && !isJsWhitespace(this.beforeTildes)))) ||
      (this.label && code === codes.rightSquareBracket)
    );
  }

  /**
   * Whether `code`, which ends the construct, comes right after a character
   * that ends any.
   */
  endsBefore(code: Code): boolean {
    return (
      this.run !== null &&
      this.runLength === 1 &&
      this.emphasis.has(this.run) &&
      !(this.run === codes.underscore && isAsciiWord(code))
    );
  }
}
