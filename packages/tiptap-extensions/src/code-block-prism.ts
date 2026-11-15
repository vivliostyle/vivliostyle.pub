import { type Attribute, findChildren, mergeAttributes } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { RefractorNode } from 'refractor';
import refractor from 'refractor';

/**
 * The fence's info string split like mdast's `code.lang` / `code.meta`: the
 * first word, which carries VFM's `lang:title` form as is, and the rest.
 */
export interface CodeBlockInfo {
  language: string | null;
  meta: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    codeBlockInfo: {
      /**
       * Sets the language and meta of the code block holding the selection.
       * Omitted fields keep their current value.
       */
      setCodeBlockInfo: (info: Partial<CodeBlockInfo>) => ReturnType;
    };
  }
}

// Markdown splits the info string at spaces and tabs only, so other
// whitespace such as U+3000 belongs to the word it touches.
const INFO_STRING_RE = /^[ \t]*([^ \t]*)[ \t]*(.*?)[ \t]*$/;

export function parseCodeBlockInfo(
  infoString: string | null | undefined,
): CodeBlockInfo {
  const [, language, meta] = infoString?.match(INFO_STRING_RE) ?? [];
  return { language: language || null, meta: meta || null };
}

export function formatCodeBlockInfo({ language, meta }: CodeBlockInfo): string {
  const clean = (value: string | null) =>
    value?.replace(/[\r\n]+/g, ' ').replace(/^[ \t]+|[ \t]+$/g, '') ?? '';
  const rest = clean(meta);
  if (!rest) {
    return clean(language);
  }
  // Without a language the meta's first word would be read as one. VFM
  // renders `text` exactly like a block without a language.
  return `${clean(language) || 'text'} ${rest}`;
}

/**
 * Reads the info back through markdown's own split, so attributes stored
 * before `meta` existed, with the whole info string in `language`, come out
 * the same as freshly parsed ones.
 */
export function getCodeBlockInfo(node: ProseMirrorNode): CodeBlockInfo {
  return parseCodeBlockInfo(
    formatCodeBlockInfo({
      language: node.attrs.language ?? null,
      meta: node.attrs.meta ?? null,
    }),
  );
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

// A fence must be longer than any run of its character that could close it
// early, and a backtick fence cannot carry backticks in its info string.
function codeFence(infoString: string, code: string): string {
  const char = infoString.includes('`') ? '~' : '`';
  const runs = code.match(char === '`' ? /^ {0,3}`+/gm : /^ {0,3}~+/gm);
  const longest = Math.max(0, ...(runs ?? []).map((run) => run.trim().length));
  return char.repeat(Math.max(3, longest + 1));
}

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
  addAttributes() {
    const parentAttributes: Record<string, Attribute | undefined> =
      this.parent?.() ?? {};
    const parseLanguageClass = parentAttributes.language?.parseHTML;
    return {
      language: {
        default: this.options.defaultLanguage,
        // The `language-*` class only names the highlight language, without
        // VFM's `:title`, so copy and paste keep the attribute itself.
        parseHTML: (element) =>
          element.dataset.language ?? parseLanguageClass?.(element) ?? null,
        renderHTML: ({ language }) =>
          language ? { 'data-language': language } : {},
      },
      meta: {
        default: null,
        parseHTML: (element) => element.dataset.meta ?? null,
        renderHTML: ({ meta }) => (meta ? { 'data-meta': meta } : {}),
      },
    };
  },

  parseMarkdown(token, helpers) {
    // marked's `lang` has backslash escapes removed and the upstream check
    // drops fences indented by one to three spaces, so read the raw line.
    const infoString = token.raw?.match(/^ {0,3}(?:`{3,}|~{3,})(.*)/)?.[1];
    if (infoString === undefined && token.codeBlockStyle !== 'indented') {
      return [];
    }
    return helpers.createNode(
      'codeBlock',
      parseCodeBlockInfo(infoString),
      token.text ? [helpers.createTextNode(token.text)] : [],
    );
  },

  renderMarkdown(node, h) {
    const infoString = formatCodeBlockInfo({
      language: node.attrs?.language ?? null,
      meta: node.attrs?.meta ?? null,
    });
    const code = node.content ? h.renderChildren(node.content) : '';
    const fence = codeFence(infoString, code);
    return `${fence}${infoString}\n${code}\n${fence}`;
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setCodeBlockInfo:
        (info) =>
        ({ state, tr, dispatch }) => {
          const block = findSelectedCodeBlock(state);
          if (!block) {
            return false;
          }
          const current = getCodeBlockInfo(block.node);
          const next = parseCodeBlockInfo(
            formatCodeBlockInfo({
              language:
                info.language === undefined ? current.language : info.language,
              meta: info.meta === undefined ? current.meta : info.meta,
            }),
          );
          const { attrs } = block.node;
          if (
            dispatch &&
            (next.language !== attrs.language || next.meta !== attrs.meta)
          ) {
            tr.setNodeMarkup(block.pos, undefined, { ...attrs, ...next });
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
