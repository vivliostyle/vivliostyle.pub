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

import { renderedAttributes } from './markdown/notations/vfm/attributes';
import { codeBlockAttributes } from './markdown/notations/vfm/headings';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    codeBlockInfo: {
      /**
       * Replaces the info string, everything after the opening fence, of the
       * code block holding the selection.
       */
      setCodeBlockInfo: (infoString: string) => ReturnType;
      /**
       * Sets the caption VFM gives the code block holding the selection, or
       * takes it away with an empty string, keeping the rest of its info
       * string as written.
       */
      setCodeBlockCaption: (caption: string) => ReturnType;
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
export function toInfoString(value: string | null | undefined): string | null {
  return value?.replace(/[\r\n]+/g, ' ') || null;
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

interface MetaTitle {
  value: string;
  start: number;
  end: number;
}

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';

/** The `title=…` or `title="…"` pairs of an info string's meta. */
function metaTitles(meta: string): MetaTitle[] {
  const titles: MetaTitle[] = [];
  const isKeyChar = (char: string | undefined) =>
    char !== undefined && char !== '"' && char !== '=' && !/\s/.test(char);
  let index = 0;
  while (index < meta.length) {
    if (!isKeyChar(meta[index])) {
      index++;
      continue;
    }
    const start = index;
    while (isKeyChar(meta[index])) {
      index++;
    }
    const key = meta.slice(start, index);
    if (meta[index] !== '=') {
      continue;
    }
    let value: string;
    let end: number;
    if (meta[index + 1] === '"') {
      const close = meta.indexOf('"', index + 2);
      if (close === -1) {
        continue;
      }
      value = meta.slice(index + 2, close);
      end = close + 1;
    } else {
      end = index + 1;
      while (
        end < meta.length &&
        meta[end] !== '"' &&
        !/\s/.test(meta[end] ?? '')
      ) {
        end++;
      }
      value = meta.slice(index + 1, end);
      if (!value) {
        continue;
      }
    }
    if (key === 'title') {
      titles.push({ value, start, end });
    }
    index = end;
  }
  return titles;
}

/** The indentation, first word, the blanks after it and the rest. */
function splitInfo(info: string | null | undefined) {
  const text = info ?? '';
  let index = 0;
  while (isBlank(text[index])) {
    index++;
  }
  const wordStart = index;
  while (index < text.length && !isBlank(text[index])) {
    index++;
  }
  const spaceStart = index;
  while (isBlank(text[index])) {
    index++;
  }
  return {
    indent: text.slice(0, wordStart),
    word: text.slice(wordStart, spaceStart),
    space: text.slice(spaceStart, index),
    meta: text.slice(index),
  };
}

/** The language and the title of `lang:title`, as VFM splits them. */
function languageTitle(
  word: string,
): { language: string; title: string } | null {
  const colon = word.indexOf(':', 1);
  return colon === -1 || colon === word.length - 1
    ? null
    : { language: word.slice(0, colon), title: word.slice(colon + 1) };
}

/**
 * The caption VFM puts in a figure around the code block: the title after
 * `:` in the language (`js:app.js`), or a `title` in the meta, which wins,
 * or one in its attributes, which wins over both.
 */
export function codeBlockCaption(
  infoString: string | null | undefined,
  attributes: Record<string, string> | null = null,
): string | null {
  const { word, meta } = splitInfo(infoString);
  if (typeof attributes?.title === 'string') {
    return attributes.title || null;
  }
  // VFM takes the value up to an `=` in it, quoted or not.
  const title = metaTitles(meta).at(-1);
  if (title) {
    return decodeString(title.value.split('=')[0] ?? '') || null;
  }
  return languageTitle(decodeString(word))?.title ?? null;
}

/**
 * The info string with the caption changed, in the form it is written in,
 * or null when it cannot be written so.
 */
export function withCodeBlockCaption(
  infoString: string | null | undefined,
  caption: string,
  attributes: Record<string, string> | null = null,
): string | null {
  if (/["\n\r]/.test(caption) || typeof attributes?.title === 'string') {
    return null;
  }
  const { indent, word, space, meta } = splitInfo(infoString);
  const titles = metaTitles(meta);
  const quoted = (value: string) =>
    /[\s]/.test(value) || !value ? `title="${value}"` : `title=${value}`;
  // VFM ends a title in the meta at `=`, so only the language holds one
  // with it, as `js:a=b`, where a title in the meta does not win over it.
  const bare = !/[\s\\&]/.test(caption);
  if (caption.includes('=') && (titles.length > 0 || !bare)) {
    return null;
  }
  if (titles.length > 0) {
    const last = titles[titles.length - 1];
    const next = caption
      ? `${meta.slice(0, last.start)}${quoted(caption)}${meta.slice(last.end)}`
      : `${meta.slice(0, last.start)}${meta.slice(last.end)}`.trim();
    return `${indent}${word}${next ? `${space || ' '}${next}` : ''}` || null;
  }
  const language = languageTitle(word)?.language;
  if (language !== undefined && (!caption || bare)) {
    const replaced = `${language}${caption ? `:${caption}` : ''}`;
    return `${indent}${replaced}${space}${meta}` || null;
  }
  if (!caption) {
    return infoString ?? null;
  }
  const lang = language ?? (word || 'text');
  if (caption.includes('=')) {
    return `${indent}${lang}:${caption}${space}${meta}`;
  }
  return `${indent}${lang}${space || ' '}${meta ? `${meta} ` : ''}${quoted(caption)}`;
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
      setCodeBlockCaption:
        (caption) =>
        ({ state, tr, dispatch }) => {
          const block = findSelectedCodeBlock(state);
          if (!block) {
            return false;
          }
          const info = withCodeBlockCaption(
            block.node.attrs.language,
            caption,
            codeBlockAttributes(block.node.attrs.language),
          );
          if (info === null && caption) {
            return false;
          }
          if (dispatch && info !== block.node.attrs.language) {
            tr.setNodeMarkup(block.pos, undefined, {
              ...block.node.attrs,
              language: toInfoString(info),
            });
          }
          return true;
        },
    };
  },

  // As VFM renders it: the attributes go on the code, and a caption makes a
  // figure around it.
  renderHTML({ node, HTMLAttributes }) {
    const language = resolveVfmLanguage(node.attrs.language) ?? 'text';
    const languageClass = `language-${language}`;
    const attributes = codeBlockAttributes(node.attrs.language);
    const rendered = renderedAttributes(attributes);
    delete rendered.title;
    const pre = [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: languageClass,
      }),
      [
        'code',
        {
          ...rendered,
          class: [languageClass, rendered.class].filter(Boolean).join(' '),
        },
        0,
      ],
    ] as const;
    const caption = codeBlockCaption(node.attrs.language, attributes);
    return caption
      ? [
          'figure',
          { class: languageClass },
          ['figcaption', { contenteditable: 'false' }, caption],
          pre,
        ]
      : pre;
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
