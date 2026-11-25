import {
  Extension,
  type Extensions,
  Mark as MarkExtension,
  Node as NodeExtension,
} from '@tiptap/core';
import type {
  DOMOutputSpec,
  NodeType,
  Node as ProseMirrorNode,
  Schema,
} from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';

import { hasDocumentNotation } from './extension';
import type { UnknownMdastNode } from './mdast';
import {
  encodeHtml,
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
import { RAW_BLOCK, RAW_INLINE } from './parse';

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
 * of the others those a theme can select it by, see `isRenderedAttribute`.
 */
function renderedElementAttributes(
  pattern: HtmlElementPattern,
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

function parseRule(pattern: HtmlElementPattern) {
  return {
    tag: selectorOf(pattern),
    // Before the rules of links and paragraphs, which the tag also is.
    priority: 60,
    getAttrs: (element: HTMLElement) => {
      const attributes: Record<string, string> = {};
      for (const attribute of Array.from(element.attributes)) {
        attributes[attribute.name.toLowerCase()] = attribute.value;
      }
      const read = matchAttributes(attributes, {
        ...pattern,
        rest: OTHER_ATTRIBUTES,
      });
      if (!read) {
        return false;
      }
      // Pasted HTML has attributes of its page, which are not the
      // document's: only those a theme can select the element by are kept.
      const { [OTHER_ATTRIBUTES]: rest, ...own } = read;
      const others = renderedAttributes(rest, pattern.tag);
      return pattern.keepOtherAttributes
        ? {
            ...own,
            [OTHER_ATTRIBUTES]: Object.keys(others).length > 0 ? others : null,
          }
        : own;
    },
  };
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

function rawText(schema: Schema, text: string, node: ProseMirrorNode) {
  const raw = schema.marks[RAW_INLINE];
  return schema.text(
    text,
    raw ? raw.create().addToSet(node.marks) : node.marks,
  );
}

function rawBlock(schema: Schema, text: string): ProseMirrorNode {
  const type = schema.nodes[RAW_BLOCK] ?? schema.nodes.paragraph;
  if (!type) {
    throw new Error('The schema has no block for raw markdown');
  }
  return type.create(null, schema.text(text));
}

/** The node's opening tag, as `pattern` writes it. */
function openingTagOf(pattern: HtmlElementPattern, node: ProseMirrorNode) {
  return openingTag(pattern, node.attrs, otherAttributesOf(node.attrs));
}

// HTML blocks end at a blank line, which a line feed can stand for.
function textblockHtml(text: string): string {
  return encodeHtml(text).replace(/\n(?=[ \t]*(?:\n|$))/g, '&#10;');
}

function sourceOf(match: string, tag: string) {
  const open = match.indexOf('>') + 1;
  return { open, close: match.length - `</${tag}>`.length };
}

/**
 * Builds a definition from a plain description, for syntax that needs no
 * code of its own. Without `extensions`, the mark or node is created for
 * the schema.
 */
export function declareNotation(
  declaration: NotationDeclaration,
  extensions?: Extensions,
): NotationDefinition {
  if (declaration.kind === 'delimitedMark') {
    return delimitedMark(declaration, extensions);
  }
  const { name, version, tag } = declaration;
  const pattern: HtmlElementPattern = declaration;
  const element = (
    kind: HtmlElementSpec['kind'],
    reference?: string,
  ): DeclaredElement => ({
    kind,
    notation: name,
    reference: reference ?? null,
  });
  const close = `</${tag}>`;
  const base = { name, ...(version !== undefined && { version }) };
  const enabled = (editor: Parameters<typeof hasDocumentNotation>[0]) => () =>
    hasDocumentNotation(editor, name);

  if (declaration.kind === 'htmlMark') {
    const mark = declaration.mark ?? name;
    const own = element('mark');
    return {
      ...base,
      extensions: extensions ?? [
        MarkExtension.create({
          name: mark,
          addAttributes: () => typeAttributes(pattern),
          parseHTML: () => [parseRule(pattern)],
          renderHTML: ({ mark: it }) => [
            tag,
            renderedElementAttributes(pattern, it.attrs),
            0,
          ],
          extendMarkSchema: (extension) =>
            extension.name === mark ? { htmlElement: own } : {},
        }),
      ],
      htmlElements: [specOf(declaration, 'mark', mark)],
      marks: {
        [mark]: {
          open: (it) =>
            openingTag(pattern, it.attrs, otherAttributesOf(it.attrs)),
          close,
        },
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
  const shared = {
    name: node,
    addAttributes: () => typeAttributes(pattern),
    parseHTML: () => [
      declaration.kind === 'htmlTextblock'
        ? { ...parseRule(pattern), preserveWhitespace: 'full' as const }
        : parseRule(pattern),
    ],
    renderHTML: ({ node: it }: { node: ProseMirrorNode }): DOMOutputSpec =>
      own.kind === 'atom'
        ? [tag, renderedElementAttributes(pattern, it.attrs)]
        : [tag, renderedElementAttributes(pattern, it.attrs), 0],
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
            const { open, close: end } = sourceOf(match[0], tag);
            const attrs = matchOpeningTag(match[0].slice(0, open), spec);
            const type = state.schema.nodes[node];
            return attrs && type
              ? type.create(attrs, content ? slice(open, end) : null)
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
            group: 'inline',
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
            const content = context.inline(it);
            // An opening tag that ends the first line of a paragraph starts
            // an HTML block instead.
            return `${openingTagOf(pattern, it)}${
              context.lineBefore === '' && content.startsWith('\n')
                ? `&#10;${content.slice(1)}`
                : content
            }${close}`;
          },
        },
        dissolve: {
          [node]: (it) => {
            const { schema } = it.type;
            const content: ProseMirrorNode[] = [];
            it.forEach((child) => {
              content.push(
                child.mark(
                  it.marks.reduce(
                    (set, mark) => mark.addToSet(set),
                    child.marks,
                  ),
                ),
              );
            });
            return [
              rawText(schema, openingTagOf(pattern, it), it),
              ...content,
              rawText(schema, close, it),
            ];
          },
        },
      };
    case 'htmlAtom':
      return {
        ...base,
        extensions: extensions ?? [
          NodeExtension.create({
            ...shared,
            group: 'inline',
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
        nodes: { [node]: (it) => `${openingTagOf(pattern, it)}${close}` },
        dissolve: {
          [node]: (it) => [
            rawText(it.type.schema, `${openingTagOf(pattern, it)}${close}`, it),
          ],
        },
      };
    case 'htmlBlock':
      return {
        ...base,
        extensions: extensions ?? [
          NodeExtension.create({
            ...shared,
            group: 'block',
            content: 'block+',
            defining: true,
          }),
        ],
        htmlElements: [spec],
        nodes: {
          [node]: (it, context) =>
            `${openingTagOf(pattern, it)}\n\n${context.children(it)}\n\n${close}`,
        },
        dissolve: {
          [node]: (it) => {
            const { schema } = it.type;
            const children: ProseMirrorNode[] = [];
            it.forEach((child) => {
              children.push(child);
            });
            return [
              rawBlock(schema, openingTagOf(pattern, it)),
              ...children,
              rawBlock(schema, close),
            ];
          },
        },
      };
    case 'htmlTextblock':
      return {
        ...base,
        extensions: extensions ?? [
          NodeExtension.create({
            ...shared,
            group: 'block',
            content: 'text*',
            marks: '',
            defining: true,
          }),
        ],
        htmlElements: [spec],
        nodes: {
          [node]: (it) =>
            `${openingTagOf(pattern, it)}${textblockHtml(it.textContent)}${close}`,
        },
        dissolve: {
          [node]: (it) => [
            rawBlock(
              it.type.schema,
              `${openingTagOf(pattern, it)}${textblockHtml(it.textContent)}${close}`,
            ),
          ],
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
export const HtmlElementCommands = Extension.create({
  name: 'htmlElementCommands',

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
