import { Extension } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';

import type { UnknownMdastNode } from '../../mdast';
import {
  charOf,
  codes,
  currentNode,
  type Effects,
  type FromMarkdownExtension,
  isLineEnding,
  type State,
  syntaxPlugin,
  type TokenizeContext,
  tokenType,
} from '../../micromark';
import {
  defineNotation,
  type FromMarkdownHandler,
  type FromMarkdownResult,
  type MarkDecorator,
  type MarkToMarkdown,
  type WriteContext,
} from '../../notation';

/**
 * Attributes of an element, in the order they are written: the id, the
 * classes separated by spaces, then the others as written.
 */
export type InlineAttributes = Record<string, string>;

const types = {
  attributes: tokenType('vfmAttributes'),
  text: tokenType('chunkText'),
};

// The characters that can end an element the attributes may follow.
const CLOSERS = new Set([...'*_~`)]>'].map((char) => char.charCodeAt(0)));

// mdast types of the elements VFM puts attributes on. References are among
// them so that their attributes stay in their source when they are raw.
const ATTRIBUTABLE = new Set([
  'strong',
  'emphasis',
  'inlineCode',
  'delete',
  'link',
  'image',
  'linkReference',
  'imageReference',
]);

type ScanResult = 'continue' | 'close' | 'fail';

interface Item {
  kind: 'id' | 'class' | 'key';
  name: string;
  value: string | undefined;
}

const SPACE = /^[ \t\v]$/;

/**
 * Reads `{…}` one character at a time, after the `{`, the way VFM's
 * attribute parser does: `.class`, `#id`, `key`, `key=value`, `key="value"`
 * and `key='value'`, separated by spaces.
 */
class AttributeScanner {
  readonly items: Item[] = [];
  private state: 'between' | 'name' | 'equals' | 'value' | 'quoted' = 'between';
  private kind: Item['kind'] = 'key';
  private name = '';
  private value = '';
  private quote = '';
  private previous = '';

  step(char: string): ScanResult {
    const previous = this.previous;
    this.previous = char;
    switch (this.state) {
      case 'between':
        if (SPACE.test(char)) {
          return 'continue';
        }
        if (char === '}') {
          return 'close';
        }
        if (char === '{' || char === '=') {
          return 'fail';
        }
        this.kind = char === '.' ? 'class' : char === '#' ? 'id' : 'key';
        this.name = this.kind === 'key' ? char : '';
        this.state = 'name';
        return 'continue';
      case 'name':
        if (SPACE.test(char) || char === '}') {
          if (!this.finish(undefined)) {
            return 'fail';
          }
          return char === '}' ? 'close' : 'continue';
        }
        if (char === '=') {
          if (this.kind !== 'key') {
            return 'fail';
          }
          this.state = 'equals';
          return 'continue';
        }
        if (char === '{') {
          return 'fail';
        }
        this.name += char;
        return 'continue';
      case 'equals':
        if (char === '"' || char === "'") {
          this.quote = char;
          this.value = '';
          this.state = 'quoted';
          return 'continue';
        }
        if (SPACE.test(char) || char === '}') {
          this.finish('');
          return char === '}' ? 'close' : 'continue';
        }
        if (char === '{' || char === '=') {
          return 'fail';
        }
        this.value = char;
        this.state = 'value';
        return 'continue';
      case 'value':
        if (SPACE.test(char) || char === '}') {
          this.finish(this.value);
          return char === '}' ? 'close' : 'continue';
        }
        if (char === '{' || char === '=') {
          return 'fail';
        }
        this.value += char;
        return 'continue';
      case 'quoted':
        if (char === this.quote && previous !== '\\') {
          this.finish(this.value.replaceAll('\\"', '"'));
          return 'continue';
        }
        this.value += char;
        return 'continue';
    }
  }

  private finish(value: string | undefined): boolean {
    this.state = 'between';
    if (!this.name) {
      return false;
    }
    this.items.push({ kind: this.kind, name: this.name, value });
    return true;
  }
}

function attributesOf(items: readonly Item[]): InlineAttributes {
  let id: string | undefined;
  const classes: string[] = [];
  const others: [string, string][] = [];
  for (const { kind, name, value } of items) {
    if (kind === 'id' || (kind === 'key' && name === 'id')) {
      id ??= kind === 'id' ? name : (value ?? '');
    } else if (kind === 'class' || name === 'class') {
      for (const it of (kind === 'class' ? name : (value ?? '')).split(/\s+/)) {
        if (it && !classes.includes(it)) {
          classes.push(it);
        }
      }
    } else if (!others.some(([key]) => key === name)) {
      others.push([name, value ?? '']);
    }
  }
  return {
    ...(id !== undefined && { id }),
    ...(classes.length > 0 && { class: classes.join(' ') }),
    ...Object.fromEntries(others),
  };
}

/** The attributes `{…}` holds, or null when it is not attributes. */
export function parseAttributes(source: string): InlineAttributes | null {
  if (!source.startsWith('{')) {
    return null;
  }
  const scanner = new AttributeScanner();
  for (let index = 1; index < source.length; index++) {
    const result = scanner.step(source[index]);
    if (result === 'fail') {
      return null;
    }
    if (result === 'close') {
      return index === source.length - 1 ? attributesOf(scanner.items) : null;
    }
  }
  return null;
}

const NAME = /^[^\s=}{"']+$/;
const BARE_VALUE = /^[^\s=}{"'\\]+$/;

/** `{…}` holding the attributes, or null when they cannot be written. */
export function formatAttributes(attributes: InlineAttributes): string | null {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (/[\n\r]/.test(value) || value.endsWith('\\')) {
      return null;
    }
    if (key === 'id' && NAME.test(value) && !/^[.#]/.test(value)) {
      parts.push(`#${value}`);
      continue;
    }
    if (key === 'class') {
      const classes = value.split(/\s+/).filter(Boolean);
      if (classes.every((it) => NAME.test(it))) {
        parts.push(...classes.map((it) => `.${it}`));
        continue;
      }
    }
    if (!NAME.test(key) || /^[.#]/.test(key)) {
      return null;
    }
    parts.push(
      value === ''
        ? key
        : BARE_VALUE.test(value)
          ? `${key}=${value}`
          : `${key}="${value.replaceAll('"', '\\"')}"`,
    );
  }
  return `{${parts.join(' ')}}`;
}

// The editor's own rendering depends on these, and event handlers are left
// out as VFM leaves them out.
const UNRENDERED = /^(?:on.*|href|src|srcset|contenteditable)$/i;

/** The attributes as the editor puts them on its own element. */
export function renderedAttributes(
  attributes: unknown,
): Record<string, string> {
  if (!attributes || typeof attributes !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(attributes as InlineAttributes).filter(
      ([key, value]) => typeof value === 'string' && !UNRENDERED.test(key),
    ),
  );
}

/**
 * `{…}` right after a character that can end an element. Whether one ended
 * there is only known once emphasis is resolved, so the braces are also read
 * as text, which is what they mean where they turn out to follow none.
 */
function tokenizeAttributes(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const scanner = new AttributeScanner();

  const content: State = (code) => {
    if (code === null || isLineEnding(code)) {
      return nok(code);
    }
    const result =
      code === codes.virtualSpace ? 'continue' : scanner.step(charOf(code));
    if (result === 'fail') {
      return nok(code);
    }
    effects.consume(code);
    if (result === 'close') {
      effects.exit(types.text);
      effects.exit(types.attributes);
      return ok;
    }
    return content;
  };

  return (code) => {
    if (
      code !== codes.leftCurlyBrace ||
      this.previous === null ||
      !CLOSERS.has(this.previous)
    ) {
      return nok(code);
    }
    effects.enter(types.attributes);
    effects.enter(types.text, { contentType: 'text' });
    effects.consume(code);
    return content;
  };
}

interface AttributedMdast extends UnknownMdastNode {
  attributes?: InlineAttributes;
}

interface Fragment extends UnknownMdastNode {
  children: UnknownMdastNode[];
}

const attributesFromMarkdown: FromMarkdownExtension = {
  enter: {
    // What the braces read as is collected aside, for where they do not
    // follow an element.
    [types.attributes]() {
      this.stack.push({ type: 'fragment', children: [] });
    },
  },
  exit: {
    [types.attributes](token) {
      const read = this.stack.pop() as unknown as Fragment;
      const parent = currentNode(this);
      const target = parent.children?.at(-1) as AttributedMdast | undefined;
      const attributes = parseAttributes(this.sliceSerialize(token));
      if (
        attributes &&
        target?.position &&
        ATTRIBUTABLE.has(target.type) &&
        target.position.end.offset === token.start.offset
      ) {
        target.attributes = attributes;
        // The element's source holds its attributes, so they are kept with
        // it where it is kept as written.
        target.position.end = {
          line: token.end.line,
          column: token.end.column,
          offset: token.end.offset,
        };
        return;
      }
      parent.children?.push(...read.children);
    },
  },
};

const ATTRIBUTED_MARKS: Record<string, string> = {
  strong: 'bold',
  emphasis: 'italic',
  inlineCode: 'code',
  delete: 'strike',
  link: 'link',
};

const ATTRIBUTED_TYPES = [...Object.values(ATTRIBUTED_MARKS), 'image'];

function mapNodes(
  result: FromMarkdownResult,
  map: (node: ProseMirrorNode) => ProseMirrorNode,
): FromMarkdownResult {
  if (!result) {
    return result;
  }
  return Array.isArray(result)
    ? result.map(map)
    : map(result as ProseMirrorNode);
}

function attributedMark(markName: string): FromMarkdownHandler {
  return (node, context, next) => {
    const { attributes } = node as AttributedMdast;
    const type = context.schema.marks[markName];
    if (!attributes || !type) {
      return next();
    }
    // A mark of the same type around it would take the attributes too.
    if (context.marks.some((mark) => mark.type === type)) {
      return context.raw(node);
    }
    return mapNodes(next(), (it) =>
      it.mark(
        it.marks.map((mark) =>
          mark.type === type
            ? type.create({ ...mark.attrs, attributes })
            : mark,
        ),
      ),
    );
  };
}

function written(mark: Mark | ProseMirrorNode): string {
  const { attributes } = mark.attrs;
  if (!attributes || typeof attributes !== 'object') {
    return '';
  }
  return formatAttributes(attributes as InlineAttributes) ?? '';
}

function delimiter(
  value: MarkToMarkdown['close'],
  mark: Mark,
  context: WriteContext,
  text: string,
): string {
  return typeof value === 'function' ? value(mark, context, text) : value;
}

const decorate: MarkDecorator = (previous) => ({
  ...previous,
  close: (mark, context, text) =>
    delimiter(previous.close, mark, context, text) + written(mark),
  ...(previous.run && {
    run: (text, mark) => (previous.run?.(text, mark) ?? text) + written(mark),
  }),
  ...(previous.implied && {
    implied: (run, context) =>
      !run.node.marks.some((mark) => written(mark)) &&
      (previous.implied?.(run, context) ?? false),
  }),
});

/** Keeps the attributes on the marks and nodes that can have them. */
export const InlineAttributesExtension = Extension.create({
  name: 'inlineAttributes',

  addGlobalAttributes() {
    return [
      {
        types: ATTRIBUTED_TYPES,
        attributes: {
          attributes: {
            default: null,
            parseHTML: () => null,
            renderHTML: (attrs) => renderedAttributes(attrs.attributes),
          },
        },
      },
    ];
  },
});

export const inlineAttributesNotation = defineNotation({
  name: 'inlineAttributes',
  version: 1,
  extensions: [InlineAttributesExtension],
  remarkPlugins: [
    syntaxPlugin(
      {
        text: {
          [codes.leftCurlyBrace]: {
            name: 'vfmAttributes',
            tokenize: tokenizeAttributes,
          },
        },
      },
      attributesFromMarkdown,
    ),
  ],
  fromMarkdown: {
    ...Object.fromEntries(
      Object.entries(ATTRIBUTED_MARKS).map(([type, mark]) => [
        type,
        attributedMark(mark),
      ]),
    ),
    paragraph: (node, _, next) => {
      const result = next();
      const [only] = node.children;
      const { attributes } = (only ?? {}) as AttributedMdast;
      if (
        !attributes ||
        !result ||
        Array.isArray(result) ||
        (result as ProseMirrorNode).type.name !== 'image'
      ) {
        return result;
      }
      const image = result as ProseMirrorNode;
      return image.type.create({ ...image.attrs, attributes });
    },
  },
  nodes: {
    image: (node, _, next) => next() + written(node),
  },
  marks: Object.fromEntries(
    Object.values(ATTRIBUTED_MARKS).map((name) => [name, decorate]),
  ),
  escapes: [{ pattern: /\{/g }],
});
