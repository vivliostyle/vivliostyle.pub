import {
  Extension,
  type Extensions,
  Mark as MarkExtension,
  Node as NodeExtension,
} from '@tiptap/core';
import type {
  DOMOutputSpec,
  Mark,
  NodeType,
  Node as ProseMirrorNode,
  Schema,
} from '@tiptap/pm/model';
import {
  type EditorState,
  NodeSelection,
  Plugin,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';

import { changedNodes, isLoading, isRemote } from './changes';
import { hasDocumentNotation } from './extension';
import { decodeHtml, encodeHtml, readStartTag } from './html';
import { matchSequences } from './match';
import type { UnknownMdastNode } from './mdast';
import {
  type ElementTags,
  type HtmlElementSpec,
  matchAttributes,
  matchOpeningTag,
  type NotationDefinition,
  openingTag,
  type ParseContext,
} from './notation';
import {
  isRenderedAttribute,
  renderedAttributes,
} from './notations/vfm/attributes';
import {
  findSelectedInline,
  insertInline,
  unwrap,
  wrapSelection,
} from './notations/vfm/commands';
import { inlineSourceRules } from './notations/vfm/input-rules';
import { inlineNodeRules } from './notations/vfm/normalize';

/**
 * The attribute of a declared element's mark or node that keeps the
 * attributes its pattern does not name, see `keepOtherAttributes`.
 */
export const OTHER_ATTRIBUTES = 'otherAttributes';

/** What an HTML element has to be for a declaration to read it. */
export interface HtmlElementPattern {
  tag: string;
  /** Classes the element must have. It may have others too. */
  classes?: readonly string[];
  /** Attributes the element must have, with these values. */
  match?: Readonly<Record<string, string>>;
  /** Attributes kept as the mark's or node's own, of the same names. */
  capture?: readonly string[];
  /** Of the attributes in `capture`, those the element must have. */
  require?: readonly string[];
  /**
   * An element with attributes or classes the pattern does not name is the
   * element too, and keeps them. Otherwise it stays raw HTML.
   */
  keepOtherAttributes?: boolean;
}

interface ElementDeclaration extends HtmlElementPattern {
  /** The definition's name, which documents record. */
  name: string;
  version?: number;
}

interface NodeDeclaration extends ElementDeclaration {
  /** The node type, the name by default. */
  node?: string;
  /**
   * The group of the node, `block` or `inline` by default, or null for none,
   * so it is only where another node's content names it.
   */
  group?: string | null;
  /**
   * What a cross-reference to an element of the node with an id calls it,
   * as `data-ref` does in Vivliostyle Themes: `fig`, `eq`, …
   */
  reference?: string;
}

/** A mark written between two copies of a delimiter, like `~~`. */
export interface DelimitedMarkDeclaration {
  kind: 'delimitedMark';
  name: string;
  mark: string;
  /** The mdast node type the parser makes of the syntax. */
  mdastType: string;
  delimiter: string;
  /** The HTML element read as the mark too, see `MarkToMarkdown.html`. */
  tag?: string;
}

/** A mark written as tags around phrasing, like `<span class="tcy">`. */
export interface HtmlMarkDeclaration extends ElementDeclaration {
  kind: 'htmlMark';
  /** The mark type, the name by default. */
  mark?: string;
}

/**
 * An inline node holding phrasing, written as tags around it, like
 * `<span class="footnote">`: unlike a mark's, two of them side by side stay
 * two.
 */
export interface HtmlInlineDeclaration extends NodeDeclaration {
  kind: 'htmlInline';
}

/**
 * An inline node without content, written as an opening tag right before
 * its closing tag, like `<a data-ref="fig" href="#id"></a>`.
 */
export interface HtmlAtomDeclaration extends NodeDeclaration {
  kind: 'htmlAtom';
}

/**
 * A block written as an HTML element around markdown, like
 * `<aside class="sidenote">`, a blank line, the content, a blank line and
 * `</aside>`. Without the blank lines VFM does not read the content as
 * markdown, and the element stays raw HTML.
 */
export interface HtmlBlockDeclaration extends NodeDeclaration {
  kind: 'htmlBlock';
  /** What it holds, as a ProseMirror content expression, `block+` by default. */
  content?: string;
}

/**
 * A textblock written as one HTML block of the element, like
 * `<p class="fig-caption">`. Markdown does not read what is in an HTML
 * block, so it holds text alone; an element holding other tags stays raw
 * HTML.
 */
export interface HtmlTextblockDeclaration extends NodeDeclaration {
  kind: 'htmlTextblock';
}

export type NotationDeclaration =
  | DelimitedMarkDeclaration
  | HtmlMarkDeclaration
  | HtmlInlineDeclaration
  | HtmlAtomDeclaration
  | HtmlBlockDeclaration
  | HtmlTextblockDeclaration;

/** What a schema's declared mark or node type is, see `declaredElementOf`. */
export interface DeclaredElement {
  kind: HtmlElementSpec['kind'];
  /** The definition the type is of. */
  notation: string;
  /** What the element has to be, see `HtmlElementPattern`. */
  pattern: HtmlElementPattern;
  /** See `NodeDeclaration.reference`. */
  reference: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    htmlElement: {
      /**
       * Gives the selection a declared element: a mark on it, a node holding
       * it (or `text` where nothing is selected), a node in place of it, a
       * block around its blocks, or its textblock as the element. In an
       * element of the type already, sets the attributes instead.
       */
      setHtmlElement: (
        type: string,
        attrs?: Record<string, unknown> | null,
        text?: string,
      ) => ReturnType;
      /** Takes the declared element the selection is in or is away. */
      unsetHtmlElement: (type: string) => ReturnType;
    };
  }
}

/** The declared element a mark or node type of the schema is, if any. */
export function declaredElementOf(
  schema: Schema,
  type: string,
): DeclaredElement | null {
  const spec = (schema.nodes[type] ?? schema.marks[type])?.spec as
    | { htmlElement?: DeclaredElement }
    | undefined;
  return spec?.htmlElement ?? null;
}

// Elements a definition may be of: none that runs script, loads anything or
// takes input. Phrasing for marks and inline nodes, flow for blocks.
const PHRASING = new Set(
  'a abbr b bdi bdo cite code data del dfn em i ins kbd mark q s samp small span strong sub sup time u var'.split(
    ' ',
  ),
);
const FLOW = new Set(
  'address article aside blockquote details div figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup nav p section summary'.split(
    ' ',
  ),
);
const ATTRIBUTE_NAME = /^[a-z_][a-z0-9_.:-]*$/;
const CLASS_NAME = /^[A-Za-z_-][A-Za-z0-9_-]*$/;
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const CONTENT = /^[A-Za-z0-9_ ?*+|(){},]+$/;

/** The attribute the editor marks its element with, which no document has. */
const ELEMENT_ATTRIBUTE = 'data-pub-element';

function validate(
  declaration: Exclude<NotationDeclaration, DelimitedMarkDeclaration>,
): void {
  const fail = (what: string) => {
    throw new Error(
      `The declaration of ${JSON.stringify(declaration.name)} ${what}`,
    );
  };
  const inline =
    declaration.kind === 'htmlMark' ||
    declaration.kind === 'htmlInline' ||
    declaration.kind === 'htmlAtom';
  if (!(inline ? PHRASING : FLOW).has(declaration.tag)) {
    fail(`cannot be of a <${declaration.tag}> element`);
  }
  const type =
    declaration.kind === 'htmlMark' ? declaration.mark : declaration.node;
  for (const name of [declaration.name, type ?? declaration.name]) {
    if (!TYPE_NAME.test(name)) {
      fail(`has a name that is no type name: ${JSON.stringify(name)}`);
    }
  }
  for (const name of declaration.classes ?? []) {
    if (!CLASS_NAME.test(name)) {
      fail(`has a class that is no class name: ${JSON.stringify(name)}`);
    }
  }
  const attributes = [
    ...Object.keys(declaration.match ?? {}),
    ...(declaration.capture ?? []),
    ...(declaration.require ?? []),
  ];
  for (const name of attributes) {
    if (
      !ATTRIBUTE_NAME.test(name) ||
      name.startsWith('on') ||
      name === 'style' ||
      name.startsWith(ELEMENT_ATTRIBUTE)
    ) {
      fail(`names an attribute it cannot have: ${JSON.stringify(name)}`);
    }
  }
  for (const name of declaration.require ?? []) {
    if (!declaration.capture?.includes(name)) {
      fail(
        `requires an attribute it does not capture: ${JSON.stringify(name)}`,
      );
    }
  }
  if (
    declaration.kind !== 'htmlMark' &&
    declaration.kind !== 'htmlBlock' &&
    'content' in declaration
  ) {
    fail('gives content to a node that holds no blocks');
  }
  if (
    declaration.kind === 'htmlBlock' &&
    declaration.content !== undefined &&
    !CONTENT.test(declaration.content)
  ) {
    fail(
      `has content that is no content expression: ${JSON.stringify(declaration.content)}`,
    );
  }
  if (
    declaration.kind !== 'htmlMark' &&
    declaration.group != null &&
    !/^[A-Za-z][A-Za-z0-9 ]*$/.test(declaration.group)
  ) {
    fail(
      `has a group that is no group name: ${JSON.stringify(declaration.group)}`,
    );
  }
}

function selectorOf(pattern: HtmlElementPattern): string {
  const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;
  return [
    pattern.tag,
    ...(pattern.classes ?? []).map((name) => `[class~=${quote(name)}]`),
    ...Object.entries(pattern.match ?? {}).map(
      ([name, value]) => `[${name}=${quote(value)}]`,
    ),
    ...(pattern.require ?? []).map((name) => `[${name}]`),
  ].join('');
}

function classesOf(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

// Links that cannot run script, as a theme's `target-counter(attr(href))`
// needs them: to an id, a relative path, or the web.
function isSafeHref(value: string): boolean {
  return /^(?:[^:]*$|[^:/?#]*[/?#]|https?:|mailto:)/i.test(value);
}

/**
 * The attributes the editor puts on the element: those of the pattern, and
 * of the others those a theme can select it by, see `isRenderedAttribute`,
 * with the type it is, so the element is read back as itself and not as
 * another node whose rule it matches.
 */
function renderedElementAttributes(
  pattern: HtmlElementPattern,
  type: string,
  attrs: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const others = renderedAttributes(attrs[OTHER_ATTRIBUTES], pattern.tag);
  const own: Record<string, string> = { ...pattern.match };
  for (const name of pattern.capture ?? []) {
    const value = attrs[name];
    if (typeof value === 'string') {
      own[name] = value;
    }
  }
  const rendered: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...others, ...own })) {
    if (
      name !== 'class' &&
      (isRenderedAttribute(name, pattern.tag) ||
        (name === 'href' && isSafeHref(value)))
    ) {
      rendered[name] = value;
    }
  }
  const classes = [
    ...new Set([
      ...(pattern.classes ?? []),
      ...classesOf(own.class),
      ...classesOf(others.class),
    ]),
  ];
  if (classes.length > 0) {
    rendered.class = classes.join(' ');
  }
  rendered[ELEMENT_ATTRIBUTE] = type;
  return rendered;
}

// The element's rule reads them all, which TipTap would otherwise read
// again from the attributes of the same names, as numbers where they look so.
function typeAttributes(pattern: HtmlElementPattern) {
  return Object.fromEntries(
    [
      ...(pattern.capture ?? []),
      ...(pattern.keepOtherAttributes ? [OTHER_ATTRIBUTES] : []),
    ].map((name) => [
      name,
      { default: null, rendered: false, parseHTML: () => null },
    ]),
  );
}

function domAttributes(element: HTMLElement): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (name !== ELEMENT_ATTRIBUTE) {
      attributes[name] = attribute.value;
    }
  }
  return attributes;
}

/**
 * The editor's own element of the type comes back as itself, with what it
 * rendered of its other attributes. Other HTML is read as the element where
 * it matches, with the attributes it declares alone: the rest are those of
 * the page it came from, not the document's.
 */
function parseRules(pattern: HtmlElementPattern, type: string) {
  const read = (element: HTMLElement) =>
    matchAttributes(domAttributes(element), {
      ...pattern,
      rest: OTHER_ATTRIBUTES,
    });
  return [
    {
      tag: `${pattern.tag}[${ELEMENT_ATTRIBUTE}="${type}"]`,
      priority: 100,
      getAttrs: (element: HTMLElement) => {
        const attrs = read(element);
        if (!attrs) {
          return false;
        }
        const { [OTHER_ATTRIBUTES]: rest, ...own } = attrs;
        const others = renderedAttributes(rest, pattern.tag);
        return pattern.keepOtherAttributes
          ? {
              ...own,
              [OTHER_ATTRIBUTES]:
                Object.keys(others).length > 0 ? others : null,
            }
          : own;
      },
    },
    {
      tag: selectorOf(pattern),
      // Before the rules of links and paragraphs, which the tag also is.
      priority: 60,
      getAttrs: (element: HTMLElement) => {
        const attrs = read(element);
        if (!attrs) {
          return false;
        }
        const { [OTHER_ATTRIBUTES]: _, ...own } = attrs;
        return own;
      },
    },
  ];
}

function otherAttributesOf(
  attrs: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const others = attrs[OTHER_ATTRIBUTES];
  return others && typeof others === 'object'
    ? (others as Record<string, string>)
    : {};
}

function specOf(
  declaration: ElementDeclaration,
  kind: HtmlElementSpec['kind'],
  type: string,
): HtmlElementSpec {
  const { tag, classes, match, capture, require, keepOtherAttributes } =
    declaration;
  return {
    kind,
    type,
    tag,
    classes,
    match,
    capture,
    require,
    ...(keepOtherAttributes && { rest: OTHER_ATTRIBUTES }),
  };
}

/** The node's opening tag, as `pattern` writes it. */
function openingTagOf(pattern: HtmlElementPattern, node: ProseMirrorNode) {
  return openingTag(pattern, node.attrs, otherAttributesOf(node.attrs));
}

/** Whether the line feed at `index` would end an HTML block. */
function endsBlock(text: string, index: number): boolean {
  let i = index + 1;
  while (text[i] === ' ' || text[i] === '\t') {
    i++;
  }
  return i >= text.length || text[i] === '\n';
}

/** The pieces of HTML text, each with the text it reads as. */
function htmlPieces(html: string): { text: string; source: string }[] {
  const pieces: { text: string; source: string }[] = [];
  let i = 0;
  while (i < html.length) {
    const end = html[i] === '&' ? html.indexOf(';', i) + 1 : 0;
    const text = end > i ? decodeHtml(html.slice(i, end)) : null;
    if (text !== null && end > i) {
      pieces.push({ text, source: html.slice(i, end) });
      i = end;
    } else {
      pieces.push({ text: html[i], source: html[i] });
      i++;
    }
  }
  return pieces;
}

/**
 * The content of a textblock element as HTML, writing what did not change
 * as `written` did. HTML blocks end at a blank line, which a line feed is
 * written as a reference for.
 */
function textblockHtml(text: string, written?: string): string {
  const pieces = written === undefined ? [] : htmlPieces(written);
  const old: { char: string; piece: number }[] = [];
  pieces.forEach((piece, index) => {
    for (const char of piece.text.split('')) {
      old.push({ char, piece: index });
    }
  });
  const chars = text.split('');
  const matches = matchSequences(
    chars,
    old.map((it) => it.char),
  );
  let html = '';
  let i = 0;
  while (i < chars.length) {
    const j = matches[i];
    if (j !== -1) {
      const index = old[j].piece;
      const piece = pieces[index];
      let whole = old[j - 1]?.piece !== index;
      for (let k = 1; whole && k < piece.text.length; k++) {
        whole = matches[i + k] === j + k;
      }
      // A line feed written as itself may now end the block.
      if (whole && !(piece.source === '\n' && endsBlock(text, i))) {
        html += piece.source;
        i += piece.text.length;
        continue;
      }
    }
    const char = chars[i];
    html += char === '\n' && endsBlock(text, i) ? '&#10;' : encodeHtml(char);
    i++;
  }
  return html;
}

function sourceOf(match: string) {
  const tag = readStartTag(match, 0);
  const close = match.lastIndexOf('</');
  return tag && close >= tag.end ? { open: tag.end, close } : null;
}

/**
 * Takes an id off every later occurrence of a mark of the type in a
 * textblock that has the same one, where this client changed it: a mark
 * split in two by an edit would otherwise give two elements the id.
 */
function uniqueMarkIds(type: string): Plugin {
  const idOf = (mark: Mark) => {
    const others = otherAttributesOf(mark.attrs);
    return typeof mark.attrs.id === 'string'
      ? mark.attrs.id
      : typeof others.id === 'string'
        ? others.id
        : null;
  };
  const withoutId = (mark: Mark) => {
    const attrs = { ...mark.attrs };
    if (typeof attrs.id === 'string') {
      attrs.id = null;
    }
    const others = { ...otherAttributesOf(attrs) };
    delete others.id;
    if (OTHER_ATTRIBUTES in attrs) {
      attrs[OTHER_ATTRIBUTES] = Object.keys(others).length > 0 ? others : null;
    }
    return mark.type.create(attrs);
  };
  return new Plugin({
    appendTransaction: (all, _, state) => {
      // Two marks of one id read from a file are the file's.
      const transactions = all.slice(all.findLastIndex(isLoading) + 1);
      if (!transactions.some((tr) => tr.docChanged && !isRemote(tr))) {
        return null;
      }
      const { tr } = state;
      for (const { pos, node } of changedNodes(
        state.doc,
        transactions,
        (it) => it.isTextblock,
      )) {
        const children: { node: ProseMirrorNode; from: number }[] = [];
        node.forEach((child, offset) => {
          children.push({ node: child, from: pos + 1 + offset });
        });
        const seen = new Set<string>();
        children.forEach(({ node: child, from }, index) => {
          const previous = children[index - 1]?.node.marks ?? [];
          for (const mark of child.marks) {
            const id = mark.type.name === type ? idOf(mark) : null;
            if (id === null || mark.isInSet(previous)) {
              continue;
            }
            if (seen.has(id)) {
              let last = index;
              while (mark.isInSet(children[last + 1]?.node.marks ?? [])) {
                last++;
              }
              const to = children[last].from + children[last].node.nodeSize;
              tr.removeMark(from, to, mark).addMark(from, to, withoutId(mark));
            }
            seen.add(id);
          }
        });
      }
      return tr.docChanged ? tr : null;
    },
  });
}

/**
 * Builds a definition from a plain description, for syntax that needs no
 * code of its own. Without `extensions`, the mark or node is created for
 * the schema. Throws where the declaration names an element, attribute or
 * type it cannot: it may come from data the user wrote.
 */
export function declareNotation(
  declaration: NotationDeclaration,
  extensions?: Extensions,
): NotationDefinition {
  if (declaration.kind === 'delimitedMark') {
    return delimitedMark(declaration, extensions);
  }
  validate(declaration);
  const { name, version, tag } = declaration;
  const pattern: HtmlElementPattern = {
    tag,
    classes: declaration.classes,
    match: declaration.match,
    capture: declaration.capture,
    require: declaration.require,
    keepOtherAttributes: declaration.keepOtherAttributes,
  };
  const element = (
    kind: HtmlElementSpec['kind'],
    reference?: string,
  ): DeclaredElement => ({
    kind,
    notation: name,
    pattern,
    reference: reference ?? null,
  });
  const close = `</${tag}>`;
  const base = { name, ...(version !== undefined && { version }) };
  const enabled = (editor: Parameters<typeof hasDocumentNotation>[0]) => () =>
    hasDocumentNotation(editor, name);
  const tagsOf = (tags: ElementTags | null, node: ProseMirrorNode) =>
    tags ?? { open: openingTagOf(pattern, node), close };

  if (declaration.kind === 'htmlMark') {
    const mark = declaration.mark ?? name;
    const own = element('mark');
    const ids = pattern.capture?.includes('id') || pattern.keepOtherAttributes;
    return {
      ...base,
      extensions: extensions ?? [
        MarkExtension.create({
          name: mark,
          addAttributes: () => typeAttributes(pattern),
          parseHTML: () => parseRules(pattern, mark),
          renderHTML: ({ mark: it }) => [
            tag,
            renderedElementAttributes(pattern, mark, it.attrs),
            0,
          ],
          extendMarkSchema: (extension) =>
            extension.name === mark ? { htmlElement: own } : {},
          addProseMirrorPlugins: () => (ids ? [uniqueMarkIds(mark)] : []),
        }),
      ],
      htmlElements: [specOf(declaration, 'mark', mark)],
      marks: {
        [mark]: {
          open: (it, context) =>
            context.markTags?.open ??
            openingTag(pattern, it.attrs, otherAttributesOf(it.attrs)),
          close: (_, context) => context.markTags?.close ?? close,
        },
      },
      dissolveMarks: {
        [mark]: (it) => ({
          open: openingTag(pattern, it.attrs, otherAttributesOf(it.attrs)),
          close,
        }),
      },
    };
  }

  const node = declaration.node ?? name;
  const own = element(
    declaration.kind === 'htmlInline'
      ? 'inline'
      : declaration.kind === 'htmlAtom'
        ? 'atom'
        : declaration.kind === 'htmlBlock'
          ? 'block'
          : 'textblock',
    declaration.reference,
  );
  const inline = own.kind === 'inline' || own.kind === 'atom';
  const group =
    declaration.group === undefined
      ? inline
        ? 'inline'
        : 'block'
      : (declaration.group ?? undefined);
  const shared = {
    name: node,
    group,
    addAttributes: () => typeAttributes(pattern),
    parseHTML: () =>
      parseRules(pattern, node).map((rule) =>
        own.kind === 'textblock'
          ? { ...rule, preserveWhitespace: 'full' as const }
          : rule,
      ),
    renderHTML: ({ node: it }: { node: ProseMirrorNode }): DOMOutputSpec =>
      own.kind === 'atom'
        ? [tag, renderedElementAttributes(pattern, node, it.attrs)]
        : [tag, renderedElementAttributes(pattern, node, it.attrs), 0],
    extendNodeSchema: (extension: { name: string }) =>
      extension.name === node ? { htmlElement: own } : {},
  };
  const spec = specOf(declaration, own.kind, node);
  const pasted = (find: RegExp, content: boolean) =>
    function (this: { editor: Parameters<typeof hasDocumentNotation>[0] }) {
      return [
        inlineSourceRules({
          find,
          enabled: enabled(this.editor),
          build: ({ state, match, content: slice }) => {
            const found = sourceOf(match[0]);
            const attrs =
              found && matchOpeningTag(match[0].slice(0, found.open), spec);
            const type = state.schema.nodes[node];
            return found && attrs && type
              ? type.create(
                  attrs,
                  content ? slice(found.open, found.close) : null,
                )
              : null;
          },
        }).paste,
      ];
    };

  switch (declaration.kind) {
    case 'htmlInline':
      return {
        ...base,
        extensions: extensions ?? [
          NodeExtension.create({
            ...shared,
            inline: true,
            content: 'inline*',
            // Code cannot hold the tags, and a link not one holding a link.
            addProseMirrorPlugins() {
              return [
                inlineNodeRules(node, {
                  marks: ['code'],
                  unlessInContent: ['link'],
                }),
              ];
            },
            addPasteRules: pasted(
              new RegExp(`<${tag}\\b[^<>]*>[^<]*</${tag}>$`, 'i'),
              true,
            ),
          }),
        ],
        htmlElements: [spec],
        nodes: {
          [node]: (it, context) => {
            const tags = tagsOf(context.tags(it), it);
            const content = context.inline(it);
            // An opening tag that ends the first line of a paragraph starts
            // an HTML block instead.
            return `${tags.open}${
              context.lineBefore === '' && content.startsWith('\n')
                ? `&#10;${content.slice(1)}`
                : content
            }${tags.close}`;
          },
        },
      };
    case 'htmlAtom':
      return {
        ...base,
        extensions: extensions ?? [
          NodeExtension.create({
            ...shared,
            inline: true,
            atom: true,
            selectable: true,
            addProseMirrorPlugins() {
              return [inlineNodeRules(node, { marks: ['code', 'link'] })];
            },
            addPasteRules: pasted(
              new RegExp(`<${tag}\\b[^<>]*></${tag}>$`, 'i'),
              false,
            ),
          }),
        ],
        htmlElements: [spec],
        nodes: {
          [node]: (it, context) => {
            const tags = tagsOf(context.tags(it), it);
            return `${tags.open}${tags.close}`;
          },
        },
      };
    case 'htmlBlock':
      return {
        ...base,
        extensions: extensions ?? [
          NodeExtension.create({
            ...shared,
            content: declaration.content ?? 'block+',
            defining: true,
          }),
        ],
        htmlElements: [spec],
        nodes: {
          [node]: (it, context) => {
            const found = context.tags(it);
            const tags = tagsOf(found, it);
            return `${tags.open}${found?.lead ?? '\n\n'}${context.children(it)}${
              found?.trail ?? '\n\n'
            }${tags.close}`;
          },
        },
      };
    case 'htmlTextblock':
      return {
        ...base,
        extensions: extensions ?? [
          NodeExtension.create({
            ...shared,
            content: 'text*',
            marks: '',
            defining: true,
          }),
        ],
        htmlElements: [spec],
        nodes: {
          [node]: (it, context) => {
            const found = context.tags(it);
            const tags = tagsOf(found, it);
            return `${tags.open}${textblockHtml(it.textContent, found?.inner)}${tags.close}`;
          },
        },
      };
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delimitedMark(
  { name, mark, mdastType, delimiter, tag }: DelimitedMarkDeclaration,
  extensions?: Extensions,
): NotationDefinition {
  return {
    name,
    extensions: extensions ?? [
      MarkExtension.create({
        name: mark,
        parseHTML: () => [{ tag: `span[data-mark="${mark}"]` }],
        renderHTML: () => ['span', { 'data-mark': mark }, 0],
      }),
    ],
    fromMarkdown: {
      [mdastType]: (node: UnknownMdastNode, context: ParseContext) => {
        const type = context.schema.marks[mark];
        return type
          ? context.inlines(node, type.create().addToSet(context.marks))
          : undefined;
      },
    },
    ...(tag && {
      htmlElements: [{ kind: 'mark' as const, type: mark, tag }],
    }),
    marks: {
      [mark]: {
        open: delimiter,
        close: delimiter,
        flanking: true,
        ...(tag && { html: tag }),
      },
    },
    escapes: [{ pattern: new RegExp(escapeRegExp(delimiter.charAt(0)), 'g') }],
  };
}

function ancestorOf(
  state: Parameters<typeof findSelectedInline>[0],
  type: NodeType,
): { pos: number; node: ProseMirrorNode } | null {
  const { $from, $to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === type) {
      const pos = $from.before(depth);
      return $to.pos <= pos + node.nodeSize ? { pos, node } : null;
    }
  }
  return null;
}

function isPlainText(node: ProseMirrorNode): boolean {
  let plain = true;
  node.forEach((child) => {
    plain &&= child.isText && child.marks.length === 0;
  });
  return plain;
}

/** The commands for the elements definitions declare, see `setHtmlElement`. */
/**
 * Keeps Backspace and Delete from joining a paragraph that holds more than
 * text into a textblock element, which holds text alone and would drop the
 * rest: the caret moves into the element instead.
 */
function refuseJoin(state: EditorState, forward: boolean): Transaction | null {
  const { selection } = state;
  const { $from } = selection;
  const parent = $from.parent;
  if (!selection.empty || !parent.isTextblock || $from.depth === 0) {
    return null;
  }
  const isElement = (node: ProseMirrorNode | null | undefined) =>
    node &&
    declaredElementOf(state.schema, node.type.name)?.kind === 'textblock';
  const index = $from.index($from.depth - 1);
  const container = $from.node($from.depth - 1);
  if (!forward && $from.parentOffset === 0) {
    const before = container.maybeChild(index - 1);
    if (isElement(before) && !isPlainText(parent)) {
      return state.tr.setSelection(
        TextSelection.create(state.doc, $from.before() - 1),
      );
    }
  }
  if (forward && $from.parentOffset === parent.content.size) {
    const after = container.maybeChild(index + 1);
    if (isElement(parent) && after?.isTextblock && !isPlainText(after)) {
      return state.tr.setSelection(
        TextSelection.create(state.doc, $from.after() + 1),
      );
    }
  }
  return null;
}

export const HtmlElementCommands = Extension.create({
  name: 'htmlElementCommands',
  // Before the keymap that joins textblocks.
  priority: 110,

  addKeyboardShortcuts() {
    const keep = (forward: boolean) => () => {
      const tr = refuseJoin(this.editor.state, forward);
      if (!tr) {
        return false;
      }
      this.editor.view.dispatch(tr);
      return true;
    };
    return { Backspace: keep(false), Delete: keep(true) };
  },

  addCommands() {
    return {
      setHtmlElement:
        (type, attrs = null, text) =>
        ({ editor, state, tr, dispatch, commands }) => {
          const element = declaredElementOf(state.schema, type);
          if (!element || !hasDocumentNotation(editor, element.notation)) {
            return false;
          }
          const nodeType = state.schema.nodes[type];
          const update = (pos: number, node: ProseMirrorNode) => {
            if (!attrs) {
              return false;
            }
            dispatch?.(
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }),
            );
            return true;
          };
          switch (element.kind) {
            case 'mark':
              return (
                !state.selection.empty && commands.setMark(type, attrs ?? {})
              );
            case 'inline': {
              const found = findSelectedInline(state, type);
              if (found) {
                return update(found.pos, found.node);
              }
              if (!nodeType) {
                return false;
              }
              if (!state.selection.empty) {
                return wrapSelection(state, tr, nodeType, attrs, !!dispatch, {
                  unmarked: ['code', 'link'],
                });
              }
              return insertInline(
                state,
                tr,
                nodeType.create(attrs, text ? state.schema.text(text) : null),
                !!dispatch,
                ['code', 'link'],
              );
            }
            case 'atom': {
              const { selection } = state;
              if (
                selection instanceof NodeSelection &&
                selection.node.type.name === type
              ) {
                return update(selection.from, selection.node);
              }
              return nodeType
                ? insertInline(state, tr, nodeType.create(attrs), !!dispatch, [
                    'code',
                    'link',
                  ])
                : false;
            }
            case 'block': {
              const found = nodeType && ancestorOf(state, nodeType);
              if (found) {
                return update(found.pos, found.node);
              }
              return commands.wrapIn(type, attrs ?? undefined);
            }
            case 'textblock': {
              const { $from, $to } = state.selection;
              const parent = $from.parent;
              if (parent.type.name === type && $from.sameParent($to)) {
                return update($from.before(), parent);
              }
              // The element holds text alone, which nothing would be lost to.
              if (
                parent.type.name !== 'paragraph' ||
                !$from.sameParent($to) ||
                !isPlainText(parent)
              ) {
                return false;
              }
              return commands.setNode(type, attrs ?? undefined);
            }
          }
        },
      unsetHtmlElement:
        (type) =>
        ({ editor, state, tr, dispatch, commands }) => {
          const element = declaredElementOf(state.schema, type);
          if (!element || !hasDocumentNotation(editor, element.notation)) {
            return false;
          }
          switch (element.kind) {
            case 'mark':
              return commands.unsetMark(type, { extendEmptyMarkRange: true });
            case 'inline': {
              const found = findSelectedInline(state, type);
              if (!found) {
                return false;
              }
              dispatch?.(unwrap(tr, found));
              return true;
            }
            case 'atom': {
              const { selection } = state;
              if (
                !(selection instanceof NodeSelection) ||
                selection.node.type.name !== type
              ) {
                return false;
              }
              dispatch?.(tr.deleteSelection());
              return true;
            }
            case 'block': {
              const nodeType = state.schema.nodes[type];
              const found = nodeType && ancestorOf(state, nodeType);
              if (!found) {
                return false;
              }
              const children: ProseMirrorNode[] = [];
              found.node.forEach((child) => {
                children.push(child);
              });
              dispatch?.(
                tr.replaceWith(
                  found.pos,
                  found.pos + found.node.nodeSize,
                  children,
                ),
              );
              return true;
            }
            case 'textblock':
              return (
                state.selection.$from.parent.type.name === type &&
                commands.setNode('paragraph')
              );
          }
        },
    };
  },
});
