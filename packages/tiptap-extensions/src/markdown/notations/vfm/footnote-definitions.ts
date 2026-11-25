import { InputRule, Node, PasteRule } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { touchesNodes } from '../../changes';
import { hasDocumentNotation } from '../../extension';
import { childrenOf, type UnknownMdastNode } from '../../mdast';
import { transformPlugin } from '../../micromark';
import { defineNotation } from '../../notation';
import { itemPrefix } from '../../source';
import { isWritableFootnoteLabel } from './footnotes';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnoteDefinition: {
      /**
       * Adds a definition of the note at the end of the document, unless it
       * has one.
       */
      insertFootnoteDefinition: (label: string, text?: string) => ReturnType;
      /** Changes the label of the definition the selection is in. */
      setFootnoteDefinitionLabel: (label: string) => ReturnType;
    };
  }
}

interface DefinitionMdast extends UnknownMdastNode {
  label?: string;
  identifier?: string;
  /** The definition interrupts a paragraph, which VFM 2 does not let it. */
  interrupting?: boolean;
}

/** The paragraph that a line right after `node` would continue lazily. */
function lastParagraph(
  node: UnknownMdastNode,
): { paragraph: UnknownMdastNode; path: UnknownMdastNode[] } | null {
  const path: UnknownMdastNode[] = [];
  let last: UnknownMdastNode | undefined = node;
  while (last && last.type !== 'paragraph') {
    path.push(last);
    last = childrenOf(last).at(-1);
  }
  return last ? { paragraph: last, path } : null;
}

function isOneParagraph(node: UnknownMdastNode): boolean {
  const [only, ...rest] = childrenOf(node);
  return (
    only?.type === 'paragraph' &&
    rest.length === 0 &&
    only.position?.end.line === node.position?.end.line
  );
}

/**
 * Ends each node in a definition where its last child ends: micromark lets
 * one run on into the prefix of the line after it, over its next sibling.
 */
function clampEnds(node: UnknownMdastNode, source: string): void {
  const children = childrenOf(node);
  children.forEach((child, index) => {
    clampEnds(child, source);
    const next = children[index + 1]?.position?.start.offset;
    const start = child.position?.start;
    const end = child.position?.end.offset;
    if (!start || next === undefined || end === undefined || end <= next) {
      return;
    }
    // One without children ends with the line it starts on.
    const found = source.indexOf('\n', start.offset ?? 0);
    const lineEnd = found === -1 ? end : Math.min(found, end);
    const last = childrenOf(child).at(-1)?.position?.end ?? {
      line: start.line,
      column: start.column + lineEnd - (start.offset ?? 0),
      offset: lineEnd,
    };
    child.position = { start, end: last };
  });
}

/**
 * A definition that would interrupt a paragraph is, to VFM 2, more lines of
 * the paragraph. One of a single paragraph is put there as raw markdown;
 * VFM reads its label as a reference. VFM 2 ends a definition at the next.
 */
function continueParagraphs(tree: UnknownMdastNode, source: string): void {
  const visit = (parent: UnknownMdastNode) => {
    const children = childrenOf(parent);
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const previous = children[index - 1];
      const line = child.position?.start.line;
      const found = previous && lastParagraph(previous);
      if (child.type === 'footnoteDefinition') {
        clampEnds(child, source);
      }
      if (
        child.type !== 'footnoteDefinition' ||
        !found ||
        found.path.some((it) => it.type === 'footnoteDefinition') ||
        line === undefined ||
        previous.position?.end.line !== line - 1
      ) {
        visit(child);
        continue;
      }
      if (!isOneParagraph(child)) {
        (child as DefinitionMdast).interrupting = true;
        continue;
      }
      const { paragraph, path } = found;
      const end = child.position?.end;
      const lineEnd = paragraph.position?.end;
      if (!end || !lineEnd || !child.position) {
        continue;
      }
      paragraph.children = [
        ...childrenOf(paragraph),
        {
          type: 'text',
          value: '\n',
          position: { start: lineEnd, end: child.position.start },
        },
        { type: 'vfmLazyLines', position: child.position },
      ];
      for (const node of [...path, paragraph]) {
        if (node.position) {
          node.position = { start: node.position.start, end };
        }
      }
      children.splice(index, 1);
      index--;
    }
  };
  visit(tree);
}

/** How labels are matched, as GFM matches them: case does not matter. */
export function footnoteIdentifier(label: string): string {
  return label.toLowerCase();
}

export interface FootnoteStatus {
  /**
   * The number VFM gives notes, in the order they are first referred to,
   * by the position of each reference, definition and inline note.
   */
  numbers: Map<number, number>;
  /** References whose label has no definition. */
  undefinedReferences: Set<number>;
  /** Definitions nothing refers to, or that another one before defines. */
  unreferencedDefinitions: Set<number>;
  duplicateDefinitions: Set<number>;
}

/** How the document's notes relate, as VFM numbers and pairs them. */
export function footnoteStatus(doc: ProseMirrorNode): FootnoteStatus {
  const definitions = new Map<string, number>();
  const duplicates = new Set<number>();
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteDefinition') {
      const id = footnoteIdentifier(String(node.attrs.label ?? ''));
      if (definitions.has(id)) {
        duplicates.add(pos);
      } else {
        definitions.set(id, pos);
      }
    }
  });
  const numbers = new Map<number, number>();
  const byLabel = new Map<string, number>();
  const undefinedReferences = new Set<number>();
  let count = 0;
  doc.descendants((node, pos) => {
    if (node.type.name === 'inlineFootnote') {
      numbers.set(pos, ++count);
    } else if (node.type.name === 'footnoteReference') {
      const id = footnoteIdentifier(String(node.attrs.label ?? ''));
      let number = byLabel.get(id);
      if (number === undefined) {
        number = ++count;
        byLabel.set(id, number);
      }
      numbers.set(pos, number);
      const definition = definitions.get(id);
      if (definition === undefined) {
        undefinedReferences.add(pos);
      } else {
        numbers.set(definition, number);
      }
    }
  });
  const unreferencedDefinitions = new Set(
    [...definitions.values()].filter((pos) => !numbers.has(pos)),
  );
  return {
    numbers,
    undefinedReferences,
    unreferencedDefinitions,
    duplicateDefinitions: duplicates,
  };
}

const footnoteStatusKey = new PluginKey<DecorationSet>('footnoteStatus');

const NOTES = new Set([
  'footnoteReference',
  'footnoteDefinition',
  'inlineFootnote',
]);

function isNote(node: ProseMirrorNode): boolean {
  return NOTES.has(node.type.name);
}

function footnoteDecorations(doc: ProseMirrorNode): DecorationSet {
  const status = footnoteStatus(doc);
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!isNote(node)) {
      return;
    }
    const attrs: Record<string, string> = {};
    if (node.type.name === 'footnoteDefinition') {
      // Mapping a decoration of a block at the top level looks the block up
      // among all of them, so a definition only has one for what is wrong.
      if (status.duplicateDefinitions.has(pos)) {
        attrs['data-duplicate'] = '';
      } else if (status.unreferencedDefinitions.has(pos)) {
        attrs['data-unreferenced'] = '';
      } else {
        return;
      }
    } else {
      const number = status.numbers.get(pos);
      if (number !== undefined) {
        attrs['data-footnote-number'] = String(number);
      }
      if (status.undefinedReferences.has(pos)) {
        attrs['data-undefined'] = '';
      }
    }
    decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs));
  });
  return DecorationSet.create(doc, decorations);
}

function hasDefinition(doc: ProseMirrorNode, label: string): boolean {
  const id = footnoteIdentifier(label);
  let found = false;
  doc.descendants((node) => {
    found ||=
      node.type.name === 'footnoteDefinition' &&
      footnoteIdentifier(String(node.attrs.label ?? '')) === id;
    return !found && !node.isTextblock;
  });
  return found;
}

const DEFINITION_LINE = /^\[\^([^\s\]]+)\]:\s$/;

export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.footnote-definition[data-label]',
        getAttrs: (element) =>
          isWritableFootnoteLabel(element.getAttribute('data-label') ?? '')
            ? null
            : false,
      },
    ];
  },

  // VFM collects definitions at the end of the document. The editor keeps
  // one where it is written, which is where it is edited.
  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label ?? '');
    return [
      'div',
      {
        ...HTMLAttributes,
        class: 'footnote-definition',
        id: `fn${label}`,
        role: 'doc-endnote',
        'data-label': label,
      },
      0,
    ];
  },

  addCommands() {
    return {
      insertFootnoteDefinition:
        (label, text) =>
        ({ editor, state, tr, dispatch }) => {
          if (
            !hasDocumentNotation(editor, this.name) ||
            !isWritableFootnoteLabel(label) ||
            hasDefinition(state.doc, label)
          ) {
            return false;
          }
          const { paragraph } = state.schema.nodes;
          if (!paragraph) {
            return false;
          }
          dispatch?.(
            tr.insert(
              tr.doc.content.size,
              this.type.create(
                { label },
                paragraph.create(null, text ? state.schema.text(text) : null),
              ),
            ),
          );
          return true;
        },
      setFootnoteDefinitionLabel:
        (label) =>
        ({ editor, state, tr, dispatch }) => {
          if (
            !hasDocumentNotation(editor, this.name) ||
            !isWritableFootnoteLabel(label)
          ) {
            return false;
          }
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            if (node.type === this.type) {
              dispatch?.(
                tr.setNodeMarkup($from.before(depth), undefined, {
                  ...node.attrs,
                  label,
                }),
              );
              return true;
            }
          }
          return false;
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: DEFINITION_LINE,
        handler: ({ state, range, match }) => {
          const label = match[1];
          const $from = state.doc.resolve(range.from);
          if (
            !label ||
            !hasDocumentNotation(this.editor, this.name) ||
            $from.parent.type.name !== 'paragraph' ||
            $from.parentOffset !== 0
          ) {
            return null;
          }
          const blockRange = $from.blockRange();
          const wrapping =
            blockRange && findWrapping(blockRange, this.type, { label });
          if (!blockRange || !wrapping) {
            return null;
          }
          const { tr } = state;
          tr.wrap(blockRange, wrapping);
          tr.delete(tr.mapping.map(range.from), tr.mapping.map(range.to));
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: /^\[\^([^\s\]]+)\]: /g,
        handler: ({ state, range, match }) => {
          const label = match[1];
          const $from = state.doc.resolve(range.from);
          if (
            !label ||
            !hasDocumentNotation(this.editor, this.name) ||
            $from.parent.type.name !== 'paragraph' ||
            $from.parentOffset !== 0
          ) {
            return;
          }
          const blockRange = state.doc.resolve(range.from).blockRange();
          const wrapping =
            blockRange && findWrapping(blockRange, this.type, { label });
          if (!blockRange || !wrapping) {
            return;
          }
          const { tr } = state;
          tr.wrap(blockRange, wrapping);
          tr.delete(tr.mapping.map(range.from), tr.mapping.map(range.to));
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: footnoteStatusKey,
        state: {
          init: (_, { doc }) => footnoteDecorations(doc),
          apply: (tr, set) =>
            !tr.docChanged
              ? set
              : touchesNodes(tr, isNote)
                ? footnoteDecorations(tr.doc)
                : set.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => footnoteStatusKey.getState(state),
        },
      }),
    ];
  },
});

export const footnoteDefinitionNotation = defineNotation({
  name: 'footnoteDefinition',
  version: 1,
  extensions: [FootnoteDefinition],
  remarkPlugins: [transformPlugin(continueParagraphs)],
  fromMarkdown: {
    footnoteDefinition: (node, context) => {
      const { label, interrupting } = node as DefinitionMdast;
      if (interrupting || !label) {
        return undefined;
      }
      return (
        context.schema.nodes.footnoteDefinition?.createAndFill(
          { label },
          context.within(itemPrefix(context.column(node) + 4), () =>
            context.blocks(node),
          ),
        ) ?? undefined
      );
    },
  },
  nodes: {
    footnoteDefinition: (node, context) => {
      const label = `[^${String(node.attrs.label ?? '')}]:`;
      const lines = context.children(node).split('\n');
      const indent = (line: string) => (line ? `    ${line}` : line);
      // Content that starts on the line after the label stays there, as a
      // block other than a paragraph goes by default.
      const nextLine = context.base?.text
        ? /^[^\n]*\]:[ \t]*\n/.test(context.base.text)
        : node.firstChild?.type.name !== 'paragraph';
      if (nextLine && lines.some(Boolean)) {
        return [label, ...lines.map(indent)].join('\n');
      }
      const [head = '', ...tail] = lines;
      return [`${label}${head ? ` ${head}` : ''}`, ...tail.map(indent)].join(
        '\n',
      );
    },
  },
});
