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

// The characters that can end an element the attributes may follow, and
// the tokens that end it there. Emphasis is only known once it is resolved.
const CLOSERS = new Map<number, readonly string[]>([
  [42, ['attentionSequence']],
  [95, ['attentionSequence']],
  [126, ['strikethroughSequenceTemporary']],
  [96, ['codeText']],
  [41, ['link', 'image']],
  [93, ['link', 'image', 'vfmFootnoteCall']],
  [62, ['autolink']],
]);

// mdast types of the elements VFM puts attributes on. Link references are
// among them so that their attributes stay in their source when they are
// raw.
const ATTRIBUTABLE = new Set([
  'strong',
  'emphasis',
  'inlineCode',
  'delete',
  'link',
  'image',
  'linkReference',
  'imageReference',
  'footnoteReference',
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
  // As VFM's parser has it, `#b` replaces an id given as `id=a` right
  // before, and is ignored after one given as `#a`.
  let idByKey = false;
  const classes: string[] = [];
  const others: [string, string][] = [];
  for (const { kind, name, value } of items) {
    if (kind === 'id') {
      if (idByKey) {
        id = name;
        idByKey = false;
      } else {
        id ??= name;
      }
    } else if (kind === 'key' && name === 'id') {
      if (id === undefined) {
        id = value ?? '';
        idByKey = true;
      }
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
const BARE_VALUE = /^[^\s=}{"']+$/;

/** `{…}` holding the attributes, or null when they cannot be written. */
export function formatAttributes(attributes: InlineAttributes): string | null {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (/[\n\r]/.test(value)) {
      return null;
    }
    if (key === 'id' && NAME.test(value)) {
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
    if (value === '') {
      parts.push(key);
    } else if (BARE_VALUE.test(value)) {
      parts.push(`${key}=${value}`);
    } else if (value.endsWith('\\')) {
      // The backslash would escape the closing quote.
      return null;
    } else {
      parts.push(`${key}="${value.replaceAll('"', '\\"')}"`);
    }
  }
  return `{${parts.join(' ')}}`;
}

/**
 * The attributes as `{…}` can hold them, with an empty class left out, or
 * null when no `{…}` reads back as them.
 */
export function writableAttributes(
  attributes: InlineAttributes,
): InlineAttributes | null {
  const normalized = Object.fromEntries(
    Object.entries(attributes).filter(
      ([key, value]) => !(key === 'class' && !value.trim()),
    ),
  );
  const written = formatAttributes(normalized);
  const read = written === null ? null : parseAttributes(written);
  return read && JSON.stringify(read) === JSON.stringify(normalized)
    ? normalized
    : null;
}

/** A name an attribute can have on an element: VFM reads more. */
export function isAttributeName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name);
}

// What a theme can select an element by, and what does not change how the
// editor behaves. The data attributes and classes of the editor's own
// rendering would make pasted HTML read as its other nodes.
const RENDERED = /^(?:id|class|lang|dir|title|role|hidden|aria-[a-z-]+)$/;
const OWN_DATA = /^data-(?:pm|raw|math|mark|type|language)/;
const OWN_CLASSES = new Set(['footnote-ref', 'footnote', 'math']);
const RENDERED_BY_ELEMENT: Record<string, ReadonlySet<string>> = {
  img: new Set(['width', 'height']),
};

/**
 * Whether the editor puts an attribute from markdown on its element, an
 * `element` of the tag name. VFM puts on almost every one.
 */
export function isRenderedAttribute(name: string, element?: string): boolean {
  const key = name.toLowerCase();
  return (
    RENDERED.test(key) ||
    (/^data-[a-z0-9_.-]+$/.test(key) && !OWN_DATA.test(key)) ||
    Boolean(element && RENDERED_BY_ELEMENT[element]?.has(key))
  );
}

/**
 * The attributes the editor puts on its own element, see
 * `isRenderedAttribute`: the document keeps the others, which are written
 * back to markdown.
 */
export function renderedAttributes(
  attributes: unknown,
  element?: string,
): Record<string, string> {
  if (!attributes || typeof attributes !== 'object') {
    return {};
  }
  const rendered: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes as InlineAttributes)) {
    if (
      typeof value !== 'string' ||
      !isAttributeName(key) ||
      !isRenderedAttribute(key, element)
    ) {
      continue;
    }
    if (key.toLowerCase() === 'class') {
      const classes = value
        .split(/\s+/)
        .filter((it) => it && !OWN_CLASSES.has(it));
      if (classes.length > 0) {
        rendered.class = classes.join(' ');
      }
      continue;
    }
    rendered[key] = value;
  }
  return rendered;
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
    const last = this.events.at(-1);
    if (
      code !== codes.leftCurlyBrace ||
      this.previous === null ||
      !last ||
      last[0] !== 'exit' ||
      !CLOSERS.get(this.previous)?.includes(last[1].type)
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
        // `{}` gives none, and keeps braces after it apart from the element.
        if (Object.keys(attributes).length > 0) {
          target.attributes = attributes;
        }
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

const ATTRIBUTED_NODES = ['image', 'footnoteReference'];

const ATTRIBUTED_TYPES = [
  ...Object.values(ATTRIBUTED_MARKS),
  ...ATTRIBUTED_NODES,
];

/**
 * Whether `{` written right after `before`, the markdown before an inline
 * node, would be read as the attributes of what `adjacent` says ends there.
 * `{}` then gives that element no attributes and keeps the braces apart.
 */
export function takesAttributes(
  before: string | undefined,
  adjacent: WriteContext['adjacent'],
): boolean {
  const last = before?.slice(-1);
  if (!adjacent || !last || !/[)\]`*_~]/.test(last)) {
    return false;
  }
  const { node, endingMarks } = adjacent;
  return (
    (ATTRIBUTED_NODES.includes(node.type.name) && !written(node)) ||
    endingMarks.some(
      (mark) =>
        Object.values(ATTRIBUTED_MARKS).includes(mark.type.name) &&
        !written(mark),
    )
  );
}

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
  ...(previous.html && {
    htmlAttributes: (mark) => ({
      ...previous.htmlAttributes?.(mark),
      ...(mark.attrs.attributes as InlineAttributes | null),
    }),
  }),
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
    const attributes = (element?: string) => ({
      attributes: {
        default: null,
        parseHTML: () => null,
        renderHTML: (attrs: Record<string, unknown>) =>
          renderedAttributes(attrs.attributes, element),
      },
    });
    return [
      {
        types: ATTRIBUTED_TYPES.filter((type) => type !== 'image'),
        attributes: attributes(),
      },
      { types: ['image'], attributes: attributes('img') },
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
    footnoteReference: (node, _, next) => {
      const { attributes } = node as AttributedMdast;
      return attributes
        ? mapNodes(next(), (it) =>
            it.type.create({ ...it.attrs, attributes }, null, it.marks),
          )
        : next();
    },
  },
  nodes: {
    image: (node, _, next) => next() + written(node),
    footnoteReference: (node, _, next) => next() + written(node),
  },
  marks: Object.fromEntries(
    Object.values(ATTRIBUTED_MARKS).map((name) => [name, decorate]),
  ),
  // Where emphasis is written as its element, the attributes go on the tag.
  htmlElements: [
    { kind: 'mark', type: 'bold', tag: 'strong', rest: 'attributes' },
    { kind: 'mark', type: 'italic', tag: 'em', rest: 'attributes' },
    { kind: 'mark', type: 'strike', tag: 'del', rest: 'attributes' },
  ],
  escapes: [{ pattern: /\{/g }],
});
