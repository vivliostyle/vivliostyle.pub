import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { decodeString } from 'micromark-util-decode-string';

import type { UnknownMdastNode } from '../../mdast';
import {
  defineNotation,
  type FromMarkdownResult,
  type ParseContext,
} from '../../notation';
import { imageMarkdown } from '../commonmark';

/** Where a run of backticks at `start` is closed by one as long, or -1. */
function closingRun(text: string, start: number, length: number): number {
  for (let index = start; index < text.length; ) {
    const run = text.slice(index).match(/^`+/)?.[0];
    if (run) {
      if (run.length === length) {
        return index;
      }
      index += run.length;
    } else {
      index++;
    }
  }
  return -1;
}

/**
 * The text between `![` and the `]` that ends an image's description, as
 * written: brackets pair, and code spans, autolinks and tags hide theirs.
 */
export function imageLabel(source: string): string | null {
  if (!source.startsWith('![')) {
    return null;
  }
  let depth = 0;
  for (let index = 2; index < source.length; index++) {
    const char = source[index];
    if (char === '\\') {
      index++;
    } else if (char === '`') {
      const run = source.slice(index).match(/^`+/)?.[0].length ?? 1;
      const close = closingRun(source, index + run, run);
      index = (close === -1 ? index : close) + run - 1;
    } else if (char === '<') {
      const tag = source.slice(index).match(/^<[^<>\n]*>/)?.[0];
      if (tag) {
        index += tag.length - 1;
      }
    } else if (char === '[') {
      depth++;
    } else if (char === ']') {
      if (depth === 0) {
        return source[index + 1] === '(' ? source.slice(2, index) : null;
      }
      depth--;
    }
  }
  return null;
}

// VFM 2 keeps the description as written, with escapes and references read.
function sourceAlt(node: UnknownMdastNode, context: ParseContext) {
  const label = imageLabel(context.source(node));
  return label === null ? undefined : decodeString(label) || null;
}

function withAlt(
  result: FromMarkdownResult,
  name: string,
  alt: string | null | undefined,
): FromMarkdownResult {
  if (alt === undefined || !result || Array.isArray(result)) {
    return result;
  }
  const node = result as ProseMirrorNode;
  return node.type.name === name
    ? node.type.create({ ...node.attrs, alt }, null, node.marks)
    : result;
}

// Read back as written once escapes and references are read.
function sourceAltText(text: string): string {
  return text.replace(/[\\[\]`<]|&(?=#?\w+;)/g, '\\$&').replace(/\n/g, '&#10;');
}

/**
 * The alt text of an image as VFM 2 reads it, which is also the caption of
 * the figure it makes of an image alone in its paragraph: the description as
 * written. CommonMark, and VFM after 2, read its plain text.
 */
export const imageAltNotation = defineNotation({
  name: 'imageAlt',
  version: 1,
  fromMarkdown: {
    paragraph: (node, context, next) => {
      const [only] = (node as UnknownMdastNode).children ?? [];
      return withAlt(
        next(),
        'image',
        only?.type === 'image' ? sourceAlt(only, context) : undefined,
      );
    },
    image: (node, context, next) =>
      withAlt(next(), 'inlineImage', sourceAlt(node, context)),
  },
  nodes: {
    image: (node) => imageMarkdown(node, sourceAltText),
    inlineImage: (node) => imageMarkdown(node, sourceAltText),
  },
});
