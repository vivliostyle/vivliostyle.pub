import type { AnyExtension, JSONContent, MarkdownToken } from '@tiptap/core';
import { ListItem } from '@tiptap/extension-list';
import { MarkdownManager } from '@tiptap/markdown';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import type { BaseContent, BaseDocument, BaseNode } from './base';
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

interface LexedToken {
  type: string;
  raw: string;
  items?: { raw: string }[];
}

// The items of a list as marked read them, so an edited list keeps the
// source of the items that did not change.
function listContent(
  body: string,
  token: LexedToken,
  node: ProseMirrorNode,
  start: number,
): BaseContent | null {
  if (token.type !== 'list' || token.items?.length !== node.childCount) {
    return null;
  }
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = start;
  for (const item of token.items) {
    if (body.slice(offset, offset + item.raw.length) !== item.raw) {
      return null;
    }
    starts.push(offset);
    ends.push(offset + item.raw.replace(/\n+$/, '').length);
    offset += item.raw.length;
  }
  return {
    children: token.items.map((_, index) => ({
      node: node.child(index),
      text: body.slice(starts[index], ends[index]),
      content: () => null,
    })),
    separator: (index) => body.slice(ends[index], starts[index + 1]),
  };
}

function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && !node.content?.length;
}

/**
 * Reads a baseline with the marked-based parser documents were made with
 * before the editor moved to remark. Their content still follows that
 * parser, e.g. raw HTML became text and footnote references became links, so
 * only this reading lets unchanged blocks keep their source.
 */
export interface LegacyBaselineReader extends BaselineReader {
  /** The document the old editor made of `body`. */
  readDocument(body: string): ProseMirrorNode | null;
}

export function createLegacyBaselineReader(
  schema: Schema,
  extensions: readonly AnyExtension[],
): LegacyBaselineReader {
  // Extensions that only bundle others would be expanded a second time.
  const manager = new MarkdownManager({
    extensions: extensions
      .filter((extension) => extension.type !== 'extension')
      .map((extension) => {
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
  // Of the baseline last read: a block written anew is read with them too.
  let definitions = '';

  return {
    readDocument(body) {
      try {
        // The old editor trimmed the file before reading it.
        const trimmed = body.trim();
        return schema.nodeFromJSON(
          manager.parse(
            definitions && trimmed.includes('[')
              ? `${trimmed}\n\n${definitions}`
              : trimmed,
          ),
        );
      } catch {
        return null;
      }
    },
    read(body) {
      const tokens: { raw: string; type: string }[] =
        new manager.instance.Lexer().lex(body);
      if (tokens.map((token) => token.raw).join('') !== body) {
        return null;
      }
      // Link reference definitions are read with every block, as the whole
      // document was.
      definitions = tokens
        .filter((token) => token.type === 'def')
        .map((token) => token.raw.trim())
        .join('\n');

      interface Segment {
        text: string;
        start: number;
        end: number;
        token: LexedToken;
        nodes: ProseMirrorNode[] | null;
      }
      const segments: Segment[] = [];
      let offset = 0;
      const blockTokens = tokens.filter((token) => token.type !== 'space');
      for (const token of tokens) {
        const start = offset;
        offset += token.raw.length;
        if (token.type === 'space') {
          continue;
        }
        const text = token.raw.replace(/\n+$/, '');
        // The token is read with the newlines it had in the document: marked
        // keeps them in the text of an HTML block. The old editor trimmed the
        // whole file, so the last block had none.
        let raw = token.raw;
        if (token === blockTokens.at(-1)) {
          raw = raw.trimEnd();
        }
        if (token === blockTokens[0]) {
          raw = raw.trimStart();
        }
        const separator = raw.endsWith('\n\n')
          ? ''
          : raw.endsWith('\n')
            ? '\n'
            : '\n\n';
        segments.push({
          text,
          start,
          end: start + text.length,
          token,
          nodes: toNodes(
            definitions && raw.includes('[')
              ? `${raw}${separator}${definitions}`
              : raw,
          ),
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
            content: () =>
              single ? listContent(body, segment.token, node, start) : null,
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
