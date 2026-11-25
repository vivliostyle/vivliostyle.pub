import { InputRule, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { join } from 'pathe';

import { hasDocumentNotation } from './markdown';
import { changedNodes, isLoading, isRemote } from './markdown/changes';
import { renderedAttributes } from './markdown/notations/vfm/attributes';
import { inlineSourceRules } from './markdown/notations/vfm/input-rules';
import { inlineNodeRules } from './markdown/notations/vfm/normalize';

// Matches absolute URLs that should bypass the in-app /vivliostyle/* prefix:
// any explicit scheme (http:, https:, blob:, data:, file:, ...) or a
// protocol-relative URL.
const ABSOLUTE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

// As TipTap's own image rule matches it.
const IMAGE_SOURCE = /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\))$/;

function resolveSource(src: unknown, basePath: string | undefined): unknown {
  return typeof src === 'string' && src && !ABSOLUTE_URL_RE.test(src)
    ? join('/vivliostyle', basePath ?? '', src)
    : src;
}

function imageAttributes(
  HTMLAttributes: Record<string, unknown>,
  options: Record<string, unknown>,
  basePath: string | undefined,
  node: ProseMirrorNode,
) {
  const { src, ...rest } = HTMLAttributes;
  const explicitAlt = (node.attrs.attributes as Record<string, unknown> | null)
    ?.alt;
  // The image's own width and height, which markdown never sets, would hide
  // the ones its attributes give.
  return mergeAttributes(options, {
    ...rest,
    ...renderedAttributes(node.attrs.attributes, 'img'),
    ...(typeof explicitAlt === 'string' && { alt: explicitAlt }),
    src: resolveSource(src, basePath),
  });
}

/**
 * The one child of a textblock but line breaks at its edges, which markdown
 * cannot hold.
 */
function loneChild(textblock: ProseMirrorNode): ProseMirrorNode | null {
  const children: ProseMirrorNode[] = [];
  textblock.forEach((child) => {
    children.push(child);
  });
  const isBreak = (node: ProseMirrorNode | undefined) =>
    Boolean(
      node &&
        (node.type.spec.linebreakReplacement ||
          (node.isText && /^\n+$/.test(node.text ?? ''))),
    );
  while (isBreak(children[0])) {
    children.shift();
  }
  while (isBreak(children.at(-1))) {
    children.pop();
  }
  return children.length === 1 ? (children[0] ?? null) : null;
}

/**
 * Turns a paragraph that an edit of this client left holding nothing but an
 * image in its text into the image on its own, as a figure. One read from
 * markdown stays: whitespace around the image keeps it in its paragraph.
 */
function loneImageRule(blockName: string, inlineName: string): Plugin {
  return new Plugin({
    appendTransaction: (all, _, state) => {
      const block = state.schema.nodes[blockName];
      const transactions = all.slice(all.findLastIndex(isLoading) + 1);
      if (
        !block ||
        !transactions.some((tr) => tr.docChanged && !isRemote(tr))
      ) {
        return null;
      }
      const { tr } = state;
      const found = changedNodes(
        state.doc,
        transactions,
        (node) => node.type.name === 'paragraph',
      );
      const mapping = new Mapping();
      for (const it of transactions) {
        mapping.appendMapping(it.mapping);
      }
      const inverted = mapping.invert();
      const before = transactions[0]?.before;
      for (const { pos, node } of found) {
        const was = before?.nodeAt(inverted.map(pos, 1));
        if (
          was?.type.name === 'paragraph' &&
          loneChild(was)?.type.name === inlineName
        ) {
          continue;
        }
        const image = loneChild(node);
        const $pos = tr.doc.resolve(pos);
        const index = $pos.index();
        if (
          image?.type.name === inlineName &&
          image.marks.length === 0 &&
          $pos.parent.canReplaceWith(index, index + 1, block)
        ) {
          tr.replaceWith(pos, pos + node.nodeSize, block.create(image.attrs));
        }
      }
      return tr.docChanged ? tr : null;
    },
  });
}

const imageRules = (enabled: () => boolean) =>
  inlineSourceRules({
    enabled,
    find: /(?<!\\)!\[([^[\]\n]*)\]\(([^()\s<>]+)(?:[ \t]+"([^"\n]*)")?\)$/,
    build: ({ state, match }) =>
      state.schema.nodes.inlineImage?.create({
        src: match[2],
        alt: match[1] || null,
        title: match[3] ?? null,
      }) ?? null,
  });

/**
 * The image that stands alone in its paragraph, which VFM makes a figure
 * captioned with its alt text, and the image in text.
 */
export function imageExtensions(basePath: string | undefined) {
  const image = Image.extend({
    addStorage() {
      return { basePath };
    },

    parseHTML() {
      return [
        ...(this.parent?.() ?? []),
        {
          tag: 'figure',
          getAttrs: (element) => {
            const img = element.querySelector('img[src]');
            if (!img) {
              return false;
            }
            return {
              src: img.getAttribute('src'),
              alt:
                element.querySelector('figcaption')?.textContent ??
                img.getAttribute('alt'),
              title: img.getAttribute('title'),
            };
          },
        },
      ];
    },

    // As VFM renders it: an image without alt text stays in its paragraph.
    renderHTML({ node, HTMLAttributes }) {
      const img = [
        'img',
        imageAttributes(
          HTMLAttributes,
          this.options.HTMLAttributes,
          this.storage.basePath,
          node,
        ),
      ] as const;
      const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
      if (!alt) {
        return ['p', img];
      }
      const explicitAlt = (
        node.attrs.attributes as Record<string, unknown> | null
      )?.alt;
      return [
        'figure',
        img,
        [
          'figcaption',
          explicitAlt !== undefined && explicitAlt !== alt
            ? {}
            : { 'aria-hidden': 'true' },
          alt,
        ],
      ];
    },

    // Where the document has images in text, the one typed is one of them.
    addInputRules() {
      const rule = nodeInputRule({
        find: IMAGE_SOURCE,
        type: this.type,
        getAttributes: (match) => {
          const [, , alt, src, title] = match;
          return { src, alt, title };
        },
      });
      return [
        new InputRule({
          find: rule.find,
          handler: (props) =>
            hasDocumentNotation(this.editor, 'inlineImage')
              ? null
              : rule.handler(props),
        }),
      ];
    },
  }).configure({});

  const inlineImage = Image.extend({
    name: 'inlineImage',

    addStorage() {
      return { basePath };
    },

    // An image in text is read as one, where the document has them: the
    // image's rule would split the paragraph around it into a figure.
    parseHTML() {
      return [
        {
          tag: 'img[src]',
          priority: 60,
          getAttrs: () =>
            this.editor && hasDocumentNotation(this.editor, this.name)
              ? null
              : false,
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        'img',
        imageAttributes(
          HTMLAttributes,
          this.options.HTMLAttributes,
          this.storage.basePath,
          node,
        ),
      ];
    },

    addCommands() {
      return {};
    },

    renderText({ node }) {
      return `![${String(node.attrs.alt ?? '')}](${String(node.attrs.src ?? '')})`;
    },

    addInputRules() {
      return [
        imageRules(() => hasDocumentNotation(this.editor, this.name)).input,
      ];
    },

    addPasteRules() {
      return [
        imageRules(() => hasDocumentNotation(this.editor, this.name)).paste,
      ];
    },

    addProseMirrorPlugins() {
      // Code cannot hold an image.
      return [
        loneImageRule('image', this.name),
        inlineNodeRules(this.name, { marks: ['code'] }),
      ];
    },
  }).configure({ inline: true });

  return { image, inlineImage };
}
