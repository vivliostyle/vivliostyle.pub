import type { AnyExtension, JSONContent, MarkdownToken } from '@tiptap/core';
import { ListItem } from '@tiptap/extension-list';
import { MarkdownManager } from '@tiptap/markdown';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import type { BaseDocument, BaseNode } from './base';
import type { BaselineReader } from './pipeline';

// The parse hooks the editor used with `@tiptap/markdown` before it moved to
// remark, so documents made back then can be matched against their source.
const legacyParseHooks: Record<string, Record<string, unknown>> = {
  listItem: {
    parseMarkdown(
      token: MarkdownToken,
      helpers: Parameters<NonNullable<typeof ListItem.config.parseMarkdown>>[1],
    ) {
      const item = ListItem.config.parseMarkdown?.(token, helpers);
      if (!item || Array.isArray(item)) {
        return item ?? [];
      }
      const node = item as JSONContent;
      if (node.content?.[0]?.type !== 'paragraph') {
        node.content = [{ type: 'paragraph' }, ...(node.content ?? [])];
      }
      return node;
    },
  },
  orderedList: {
    markdownTokenizer: {
      name: 'orderedList',
      level: 'block',
      start: () => -1,
      tokenize: () => undefined,
    },
    parseMarkdown(
      token: MarkdownToken,
      helpers: { parseChildren: (tokens: MarkdownToken[]) => JSONContent[] },
    ) {
      if (token.type !== 'list' || !token.ordered) {
        return [];
      }
      const start = Number(token.start) || 1;
      return {
        type: 'orderedList',
        ...(start !== 1 && { attrs: { start } }),
        content: token.items ? helpers.parseChildren(token.items) : [],
      };
    },
  },
  codeBlock: {
    parseMarkdown(
      token: MarkdownToken,
      helpers: {
        createNode: (
          type: string,
          attrs: Record<string, unknown>,
          content: JSONContent[],
        ) => JSONContent;
        createTextNode: (text: string) => JSONContent;
      },
    ) {
      const infoString = token.raw?.match(/^ {0,3}(?:`{3,}|~{3,})(.*)/)?.[1];
      if (infoString === undefined && token.codeBlockStyle !== 'indented') {
        return [];
      }
      return helpers.createNode(
        'codeBlock',
        { language: infoString || null },
        token.text ? [helpers.createTextNode(token.text)] : [],
      );
    },
  },
};

function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && !node.content?.length;
}

/**
 * Reads a baseline with the marked-based parser documents were made with
 * before the editor moved to remark. Their content still follows that
 * parser, e.g. raw HTML became text and footnote references became links, so
 * only this reading lets unchanged blocks keep their source.
 */
export function createLegacyBaselineReader(
  schema: Schema,
  extensions: readonly AnyExtension[],
): BaselineReader {
  const manager = new MarkdownManager({
    extensions: extensions.map((extension) => {
      const hooks = legacyParseHooks[extension.name];
      return hooks ? extension.extend(hooks) : extension;
    }),
  });

  const toNodes = (markdown: string): ProseMirrorNode[] | null => {
    try {
      return (manager.parse(markdown).content ?? [])
        .filter((block) => !isEmptyParagraph(block))
        .map((block) => schema.nodeFromJSON(block));
    } catch {
      return null;
    }
  };

  return {
    read(body) {
      const tokens: { raw: string; type: string }[] =
        new manager.instance.Lexer().lex(body);
      if (tokens.map((token) => token.raw).join('') !== body) {
        return null;
      }
      // Link reference definitions are read with every block, as the whole
      // document was.
      const definitions = tokens
        .filter((token) => token.type === 'def')
        .map((token) => token.raw.trim())
        .join('\n');

      interface Segment {
        text: string;
        start: number;
        end: number;
        nodes: ProseMirrorNode[] | null;
      }
      const segments: Segment[] = [];
      let offset = 0;
      for (const token of tokens) {
        const start = offset;
        offset += token.raw.length;
        if (token.type === 'space') {
          continue;
        }
        const text = token.raw.replace(/\n+$/, '');
        segments.push({
          text,
          start,
          end: start + text.length,
          nodes: toNodes(definitions ? `${text}\n\n${definitions}` : text),
        });
      }

      const children: (BaseNode | null)[] = [];
      const starts: number[] = [];
      const ends: number[] = [];
      const detached = new Map<number, string>();
      const detach = (index: number, text: string) => {
        const kept = detached.get(index);
        detached.set(index, kept ? `${kept}\n\n${text}` : text);
      };
      // Source that makes no block, such as a definition, goes with the
      // block before it, or the one after it at the start of the document.
      let pending: { start: number; texts: string[] } | null = null;
      for (const segment of segments) {
        const nodes = segment.nodes ?? [];
        if (segment.nodes && nodes.length === 0) {
          const anchor = children.length - 1;
          const previous = children[anchor];
          if (previous && previous.text !== null) {
            previous.text += body.slice(ends[anchor], segment.end);
            ends[anchor] = segment.end;
            detach(anchor, segment.text);
          } else if (previous === undefined) {
            pending ??= { start: segment.start, texts: [] };
            pending.texts.push(segment.text);
          } else {
            detach(anchor, segment.text);
          }
          continue;
        }
        const start = pending?.start ?? segment.start;
        nodes.forEach((node, index) => {
          const single = nodes.length === 1;
          children.push({
            node,
            text: single ? body.slice(start, segment.end) : null,
            content: () => null,
          });
          starts.push(index === 0 ? start : segment.end);
          ends.push(segment.end);
        });
        if (pending && nodes.length > 0) {
          for (const text of pending.texts) {
            detach(children.length - nodes.length, text);
          }
          pending = null;
        }
      }

      const first = starts.at(0);
      return {
        children,
        separator(index) {
          if (
            children[index]?.text == null ||
            children[index + 1]?.text == null
          ) {
            return null;
          }
          return body.slice(ends[index], starts[index + 1]);
        },
        leading: first === undefined ? '' : body.slice(0, first),
        trailing: body.slice(ends.at(-1) ?? 0),
        detached,
      } satisfies BaseDocument;
    },
  };
}
