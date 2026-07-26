import { findChildren, mergeAttributes } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { RefractorNode } from 'refractor';
import refractor from 'refractor';

/**
 * Derives the highlight language the same way VFM does: remark splits the
 * info string at the first whitespace, then VFM strips the `:title` part
 * (`js:example.js` → `js`). See @vivliostyle/vfm lib/plugins/code.js.
 */
export function resolveVfmLanguage(
  infoString: string | null | undefined,
): string | null {
  const word = infoString?.match(/^[^ \t]+/)?.[0];
  if (!word) {
    return null;
  }
  const match = word.match(/^(.+?):(.+)$/);
  return match ? match[1] : word;
}

interface HighlightSpan {
  text: string;
  classes: string[];
}

// Nested refractor elements are flattened into spans carrying all ancestor
// classes, because ProseMirror inline decorations cannot nest.
export function flattenRefractorNodes(
  nodes: RefractorNode[],
  classes: string[] = [],
): HighlightSpan[] {
  return nodes.flatMap((node) => {
    if (node.type === 'text') {
      return [{ text: node.value, classes }];
    }
    return flattenRefractorNodes(node.children, [
      ...new Set([...classes, ...(node.properties.className ?? [])]),
    ]);
  });
}

function buildDecorations(doc: ProseMirrorNode, nodeName: string) {
  const decorations: Decoration[] = [];
  for (const block of findChildren(
    doc,
    (node) => node.type.name === nodeName,
  )) {
    const language = resolveVfmLanguage(block.node.attrs.language);
    if (!language || !refractor.registered(language)) {
      continue;
    }
    let from = block.pos + 1;
    for (const span of flattenRefractorNodes(
      refractor.highlight(block.node.textContent, language),
    )) {
      const to = from + span.text.length;
      if (span.classes.length > 0) {
        decorations.push(
          Decoration.inline(from, to, { class: span.classes.join(' ') }),
        );
      }
      from = to;
    }
  }
  return DecorationSet.create(doc, decorations);
}

function prismHighlightPlugin(nodeName: string) {
  return new Plugin({
    key: new PluginKey('prismHighlight'),
    state: {
      init: (_, { doc }) => buildDecorations(doc, nodeName),
      apply: (tr, decorationSet, oldState) => {
        if (!tr.docChanged) {
          return decorationSet.map(tr.mapping, tr.doc);
        }
        const oldBlocks = findChildren(
          oldState.doc,
          (node) => node.type.name === nodeName,
        );
        const newBlocks = findChildren(
          tr.doc,
          (node) => node.type.name === nodeName,
        );
        // Range-intersection check (rather than selection heuristics) so that
        // remote Yjs transactions also trigger re-highlighting.
        let touchesBlock = newBlocks.length !== oldBlocks.length;
        if (!touchesBlock) {
          for (const step of tr.steps) {
            step.getMap().forEach((fromA, toA) => {
              touchesBlock ||= oldBlocks.some(
                (block) =>
                  fromA <= block.pos + block.node.nodeSize && toA >= block.pos,
              );
            });
            if (touchesBlock) {
              break;
            }
          }
        }
        return touchesBlock
          ? buildDecorations(tr.doc, nodeName)
          : decorationSet.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

/**
 * CodeBlock rendered to match VFM's output: `language-*` class on both
 * `<pre>` and `<code>` (falling back to `text`), plus Prism token spans
 * generated with the same refractor version VFM uses.
 */
export const CodeBlockPrism = CodeBlock.extend({
  renderHTML({ node, HTMLAttributes }) {
    const language = resolveVfmLanguage(node.attrs.language) ?? 'text';
    const languageClass = `language-${language}`;
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: languageClass,
      }),
      ['code', { class: languageClass }, 0],
    ];
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), prismHighlightPlugin(this.name)];
  },
});
