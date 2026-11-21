import {
  type Attribute,
  Extension,
  findChildren,
  mergeAttributes,
} from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { decodeString } from 'micromark-util-decode-string';
import type { RefractorNode } from 'refractor';
import refractor from 'refractor';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    codeBlockInfo: {
      /**
       * Replaces the info string, everything after the opening fence, of the
       * code block holding the selection.
       */
      setCodeBlockInfo: (infoString: string) => ReturnType;
    };
  }
}

/** The code block that holds the whole text selection. */
export function findSelectedCodeBlock(
  state: EditorState,
): { pos: number; node: ProseMirrorNode } | null {
  const { $from, $to } = state.selection;
  if ($from.parent.type.name !== 'codeBlock' || !$from.sameParent($to)) {
    return null;
  }
  return { pos: $from.before(), node: $from.parent };
}

/** Language names and aliases the editor and VFM can highlight. */
export function listHighlightLanguages(): string[] {
  return [...refractor.listLanguages()].sort();
}

// A line break would end the fence line early and turn the rest of the info
// string into markdown outside the code block.
function toInfoString(value: string | null | undefined): string | null {
  return value?.replace(/[\r\n]+/g, ' ') || null;
}

// A fence must be longer than any run of its character that could close it
// early, and a backtick fence cannot carry backticks in its info string.
function codeFence(infoString: string, code: string): string {
  const char = infoString.includes('`') ? '~' : '`';
  const runs = code.match(char === '`' ? /^ {0,3}`+/gm : /^ {0,3}~+/gm);
  // Not Math.max(...runs): a long enough code block exceeds the engine's
  // argument limit.
  let longest = 0;
  for (const run of runs ?? []) {
    longest = Math.max(longest, run.trim().length);
  }
  return char.repeat(Math.max(3, longest + 1));
}

/**
 * Derives the highlight language the same way VFM does: remark splits the
 * info string at the first whitespace and decodes escapes and character
 * references in that word, then VFM strips the `:title` part
 * (`js:example.js`, `js\:example.js` → `js`). See @vivliostyle/vfm
 * lib/plugins/code.js.
 */
export function resolveVfmLanguage(
  infoString: string | null | undefined,
): string | null {
  const word = infoString?.match(/^[ \t]*([^ \t]+)/)?.[1];
  if (!word) {
    return null;
  }
  const language = decodeString(word);
  const match = language.match(/^(.+?):(.+)$/);
  return match ? match[1] : language;
}

/**
 * Turns the textblock at the caret into a code block when it holds nothing
 * but an opening fence line, e.g. "```js title=a.js".
 */
export function convertFenceLine(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from, empty } = state.selection;
  const { parent } = $from;
  const { codeBlock } = state.schema.nodes;
  if (
    !empty ||
    !codeBlock ||
    parent.type.spec.code ||
    $from.parentOffset !== parent.content.size ||
    parent.textContent.length !== parent.content.size
  ) {
    return false;
  }
  const match = parent.textContent.match(/^(`{3,}|~{3,})(.*)$/);
  // Markdown does not read a backtick fence with backticks in its info string
  // as a fence.
  if (!match || (match[1].startsWith('`') && match[2].includes('`'))) {
    return false;
  }
  const index = $from.index(-1);
  if (!$from.node(-1).canReplaceWith(index, index + 1, codeBlock)) {
    return false;
  }
  if (dispatch) {
    const start = $from.start();
    dispatch(
      state.tr
        .delete(start, $from.end())
        .setBlockType(start, start, codeBlock, {
          language: toInfoString(match[2].trim()),
        })
        .scrollIntoView(),
    );
  }
  return true;
}

// Has to run before the Enter handlers of lists, which would split the item
// holding the fence line instead.
const CodeFenceEnter = Extension.create({
  name: 'codeFenceEnter',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () =>
        this.editor.commands.command(({ state, dispatch }) =>
          convertFenceLine(state, dispatch),
        ),
    };
  },
});

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
  addAttributes() {
    const parentAttributes: Record<string, Attribute | undefined> =
      this.parent?.() ?? {};
    const parseLanguageClass = parentAttributes.language?.parseHTML;
    return {
      // Holds the whole info string as written, like TipTap's own parser
      // does with marked's `lang`; the highlight language is its first word.
      language: {
        default: this.options.defaultLanguage,
        // The `language-*` class only names the highlight language, so copy
        // and paste keep the info string itself.
        parseHTML: (element) =>
          toInfoString(
            element.dataset.language ?? parseLanguageClass?.(element),
          ),
        renderHTML: ({ language }) =>
          language ? { 'data-language': language } : {},
      },
    };
  },

  parseMarkdown(token, helpers) {
    // marked's `lang` is trimmed and has backslash escapes removed, and the
    // upstream check drops fences indented by one to three spaces.
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

  renderMarkdown(node, h) {
    // Also covers values that arrive without setCodeBlockInfo, e.g. over Yjs.
    const infoString = toInfoString(node.attrs?.language) ?? '';
    const code = node.content ? h.renderChildren(node.content) : '';
    const fence = codeFence(infoString, code);
    // Leading tildes would lengthen a tilde fence instead of starting the
    // info string; markdown ignores the space.
    const separator = infoString.startsWith(fence.charAt(0)) ? ' ' : '';
    return `${fence}${separator}${infoString}\n${code}\n${fence}`;
  },

  addExtensions() {
    return [CodeFenceEnter];
  },

  // The inherited rules convert on the first space after the fence, before
  // an info string with meta can be typed; Enter converts instead.
  addInputRules() {
    return [];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setCodeBlockInfo:
        (infoString) =>
        ({ state, tr, dispatch }) => {
          const block = findSelectedCodeBlock(state);
          if (!block) {
            return false;
          }
          const language = toInfoString(infoString);
          if (dispatch && language !== block.node.attrs.language) {
            tr.setNodeMarkup(block.pos, undefined, {
              ...block.node.attrs,
              language,
            });
          }
          return true;
        },
    };
  },

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

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // The inherited handler clears the node, which also lifts it out of
      // every list and quote around it.
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection;
        if (
          !empty ||
          $anchor.parent.type !== this.type ||
          ($anchor.pos !== 1 && $anchor.parent.content.size > 0)
        ) {
          return false;
        }
        return this.editor.commands.setBlockFormat('paragraph');
      },
    };
  },
});
