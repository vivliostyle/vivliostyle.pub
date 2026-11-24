import type { Data, Processor } from 'unified';

import type { UnknownMdastNode } from './mdast';

// micromark-util-types and mdast-util-from-markdown are only transitive
// dependencies, so their types are taken from the processor data that
// remark-parse declares.
export type MicromarkExtension = NonNullable<
  Data['micromarkExtensions']
>[number];
type ConstructRecord = NonNullable<MicromarkExtension['text']>;
export type Construct = Exclude<
  NonNullable<ConstructRecord[keyof ConstructRecord]>,
  readonly unknown[]
>;
export type Tokenizer = Construct['tokenize'];
export type TokenizeContext = ThisParameterType<Tokenizer>;
export type Effects = Parameters<Tokenizer>[0];
export type State = Parameters<Tokenizer>[1];
export type Code = Parameters<State>[0];
export type Resolver = NonNullable<Construct['resolveAll']>;
type Event = Parameters<Resolver>[0][number];
export type Token = Event[1];
export type TokenType = Token['type'];

export type FromMarkdownExtension = Exclude<
  NonNullable<Data['fromMarkdownExtensions']>[number],
  readonly unknown[]
>;
type Handles = NonNullable<FromMarkdownExtension['enter']>;
export type Handle = NonNullable<Handles[keyof Handles]>;
export type CompileContext = ThisParameterType<Handle>;

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

// Character codes as micromark passes them: line endings and tabs are
// negative, and the end of the input is null.
export const codes = {
  horizontalTab: -2,
  virtualSpace: -1,
  space: 32,
  exclamationMark: 33,
  quotationMark: 34,
  numberSign: 35,
  dollarSign: 36,
  apostrophe: 39,
  leftParenthesis: 40,
  rightParenthesis: 41,
  dot: 46,
  equalsTo: 61,
  leftSquareBracket: 91,
  backslash: 92,
  rightSquareBracket: 93,
  caret: 94,
  graveAccent: 96,
  leftCurlyBrace: 123,
  verticalBar: 124,
  rightCurlyBrace: 125,
} as const;

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

/**
 * What would end emphasis or a link opened before the current position: the
 * markers of open emphasis and strikethrough, and whether a link's label is
 * open. VFM 2 reads those first, so a construct that would run past one of
 * them does not start there.
 */
export function openBefore(context: TokenizeContext): {
  markers: ReadonlySet<number>;
  label: boolean;
} {
  const open = new Map<number, number>();
  const links = new Set<number>();
  for (const [kind, token] of context.events) {
    if (kind === 'enter' && (token.type === 'link' || token.type === 'image')) {
      links.add(token.start.offset);
    }
  }
  let label = false;
  for (const [kind, token] of context.events) {
    if (kind !== 'exit') {
      continue;
    }
    const type = token.type as string;
    if (
      type === 'attentionSequence' ||
      type === 'strikethroughSequenceTemporary'
    ) {
      const marker = context.sliceSerialize(token).charCodeAt(0);
      const count = open.get(marker) ?? 0;
      if (token._close && count > 0) {
        open.set(marker, count - 1);
      } else if (token._open) {
        open.set(marker, count + 1);
      }
    } else if (
      (type === 'labelLink' || type === 'labelImage') &&
      !token._balanced &&
      !token._inactive &&
      !links.has(token.start.offset)
    ) {
      label = true;
    }
  }
  return {
    markers: new Set(
      [...open].filter(([, count]) => count > 0).map(([marker]) => marker),
    ),
    label,
  };
}

/** Whether `code`, after `previous`, would end what `openBefore` found. */
export function endsOpen(
  open: ReturnType<typeof openBefore>,
  code: Code,
  previous: Code,
): boolean {
  if (code === null) {
    return false;
  }
  return (
    (open.label && code === codes.rightSquareBracket) ||
    (open.markers.has(code) && previous !== null && !isJsWhitespace(previous))
  );
}
