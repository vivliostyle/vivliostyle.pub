import { type Editor, Extension } from '@tiptap/core';
import {
  Fragment,
  type Mark,
  type Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import { Plugin, type Transaction } from '@tiptap/pm/state';

import { changedNodes, isRemote, markLoading } from './changes';
import type { NotationDefinition } from './notation';
import { RAW_INLINE } from './parse';
import {
  MarkdownPipeline,
  notationSignature,
  type ParsedMarkdown,
} from './pipeline';
import { MarkdownWriteError, type WriteResult } from './write';

/** What a document records, outside its content, about how it was made. */
export interface DocumentRecord {
  /** See `setDocumentNotations`. */
  notations: string | null;
  /** The frontmatter, when it is recorded with the document. */
  frontmatter?: string | undefined;
}

export interface PubMarkdownOptions {
  notations: NotationDefinition[];
  /**
   * Reads the document's record each time the document is written, so no
   * caller can write it without: the record can change at any time, e.g.
   * through another client.
   */
  documentRecord?: ((editor: Editor) => DocumentRecord) | undefined;
  /** Called after `setMarkdown` has replaced the document. */
  onSetMarkdown?: ((editor: Editor) => void) | undefined;
}

export interface PubMarkdownStorage {
  /**
   * The markdown the document was last read from or written as. Saving
   * reuses its source for whatever did not change.
   */
  baseline: string;
  /**
   * The definitions the document was made with, as a signature, when they
   * are not the current ones.
   */
  documentNotations: string | null;
  pipelines: Map<string, MarkdownPipeline>;
  /** The last write that failed, so the same state is not tried again. */
  failure: {
    key: readonly unknown[];
    error: MarkdownWriteError;
  } | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pubMarkdown: {
      /** Replaces the document with markdown, which becomes the baseline. */
      setMarkdown: (
        markdown: string,
        options?: { emitUpdate?: boolean },
      ) => ReturnType;
    };
  }

  interface Storage {
    pubMarkdown: PubMarkdownStorage;
  }
}

function storageOf(editor: Editor): PubMarkdownStorage {
  const storage = editor.storage.pubMarkdown;
  if (!storage) {
    throw new Error('The editor has no PubMarkdown extension');
  }
  return storage;
}

function optionsOf(editor: Editor): PubMarkdownOptions {
  return (
    editor.extensionManager.extensions.find(
      (extension) => extension.name === 'pubMarkdown',
    )?.options ?? { notations: [] }
  );
}

function pipelineOf(
  editor: Editor,
  notations: readonly NotationDefinition[],
): MarkdownPipeline {
  const storage = storageOf(editor);
  const signature = notationSignature(notations);
  let pipeline = storage.pipelines.get(signature);
  if (!pipeline) {
    pipeline = new MarkdownPipeline(editor.schema, notations);
    storage.pipelines.set(signature, pipeline);
  }
  return pipeline;
}

/**
 * The definitions a signature names, each at the version it names, and
 * whether all of them are there at that version.
 */
function notationsOf(
  editor: Editor,
  entries: readonly { name: string; version: number }[],
): { notations: NotationDefinition[]; exact: boolean } {
  const all = optionsOf(editor).notations;
  let exact = true;
  const notations = all.flatMap((notation) => {
    const entry = entries.find((it) => it.name === notation.name);
    if (!entry) {
      return [];
    }
    if (entry.version === (notation.version ?? 1)) {
      return [notation];
    }
    const earlier = notation.earlier?.find(
      (it) => (it.version ?? 1) === entry.version,
    );
    exact &&= Boolean(earlier);
    return [earlier ?? notation];
  });
  exact &&= entries.every((entry) =>
    all.some((notation) => notation.name === entry.name),
  );
  return { notations, exact };
}

function currentPipeline(editor: Editor): MarkdownPipeline {
  return pipelineOf(editor, optionsOf(editor).notations);
}

/** The pipeline the editor reads markdown with now. */
export function markdownPipeline(editor: Editor): MarkdownPipeline {
  return currentPipeline(editor);
}

/** The signature of the definitions the editor reads markdown with now. */
export function currentNotations(editor: Editor): string {
  return currentPipeline(editor).signature;
}

/**
 * Whether the definitions the document is read and written with include the
 * one named, i.e. whether its syntax means something in the document. The
 * record is read anew, as for a write.
 */
export function hasDocumentNotation(editor: Editor, name: string): boolean {
  const storage = storageOf(editor);
  const record = optionsOf(editor).documentRecord?.(editor);
  const signature = record ? record.notations : storage.documentNotations;
  if (signature === null || signature === currentNotations(editor)) {
    return optionsOf(editor).notations.some((it) => it.name === name);
  }
  return signature.split(' ').some((entry) => entry.split('@')[0] === name);
}

/**
 * The pipeline that writes the document the way it was read: a document
 * keeps meaning what it meant when it was made.
 */
function documentPipeline(
  editor: Editor,
  signature: string | null,
): {
  pipeline: MarkdownPipeline;
  approximate: boolean;
} {
  if (signature === null || signature === currentNotations(editor)) {
    return { pipeline: currentPipeline(editor), approximate: false };
  }
  const entries = signature.split(' ').map((entry) => {
    const [name, version] = entry.split('@');
    return { name, version: version ? Number(version) : 1 };
  });
  // A definition that is gone, or no longer there at the version the
  // document was made with, cannot be brought back: the document is written
  // with what is there, without rewriting what was not edited.
  const { notations, exact } = notationsOf(editor, entries);
  return { pipeline: pipelineOf(editor, notations), approximate: !exact };
}

/**
 * What the document's definitions can write, when they are not all the
 * editor has: node and mark types, and the attributes of the definitions
 * they lack.
 */
function documentWrites(editor: Editor): {
  pipeline: MarkdownPipeline;
  lostAttributes: ReadonlySet<string>;
} | null {
  const storage = storageOf(editor);
  const record = optionsOf(editor).documentRecord?.(editor);
  const signature = record ? record.notations : storage.documentNotations;
  if (signature === null || signature === currentNotations(editor)) {
    return null;
  }
  const { pipeline } = documentPipeline(editor, signature);
  const kept = new Set(pipeline.notations.map((it) => it.name));
  const lostAttributes = new Set(
    optionsOf(editor)
      .notations.filter((it) => !kept.has(it.name))
      .flatMap((it) => it.attributes ?? []),
  );
  return { pipeline, lostAttributes };
}

function childrenOfNode(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return children;
}

/**
 * What the markdown the editor writes of a node means to the document's
 * definitions, so that VFM reads it as the node all the same: an inline
 * node is that markdown kept raw, and a block is what the definitions read
 * of it, where the syntax they lack is raw or text written back as it is.
 */
function asDocumentReads(
  editor: Editor,
  documentPipeline: MarkdownPipeline,
  node: ProseMirrorNode,
  parent: ProseMirrorNode,
): ProseMirrorNode[] | null {
  const { schema } = editor;
  const { paragraph } = schema.nodes;
  const raw = schema.marks[RAW_INLINE];
  const wrapper = node.isInline
    ? paragraph
    : schema.topNodeType.contentMatch.matchType(node.type)
      ? null
      : parent.type;
  try {
    const doc = schema.topNodeType.create(
      null,
      wrapper
        ? wrapper.create(
            wrapper === parent.type ? parent.attrs : null,
            node.isInline ? node.mark([]) : node,
          )
        : node,
    );
    const { markdown } = currentPipeline(editor).serializeWithResult(doc, {
      baseline: '',
    });
    if (node.isInline) {
      const text = markdown.trim();
      return raw && text
        ? [schema.text(text, raw.create().addToSet(node.marks))]
        : null;
    }
    const read = documentPipeline.parse(markdown).doc;
    if (!wrapper) {
      return childrenOfNode(read);
    }
    const [only, ...rest] = childrenOfNode(read);
    return only?.type === wrapper && rest.length === 0
      ? childrenOfNode(only)
      : null;
  } catch {
    return null;
  }
}

/**
 * Turns what the document's definitions cannot write into what they can,
 * wherever this client changed the document, as by pasting HTML: a node,
 * or one with an attribute of a definition the document lacks, becomes
 * what they read of its markdown, and a mark is taken off or loses the
 * attribute. Where that does not fit, a node becomes its content or its
 * text, and the attribute is cleared.
 */
function dissolveUnwritable(editor: Editor): Plugin {
  return new Plugin({
    appendTransaction: (transactions, _, state) => {
      if (!transactions.some((tr) => tr.docChanged && !isRemote(tr))) {
        return null;
      }
      const writes = documentWrites(editor);
      if (!writes) {
        return null;
      }
      const { pipeline, lostAttributes } = writes;
      const { writer } = pipeline;
      const lost = (type: string, attrs: Record<string, unknown>) =>
        Object.keys(attrs).filter(
          (name) =>
            attrs[name] != null &&
            (lostAttributes.has(name) || lostAttributes.has(`${type}:${name}`)),
        );
      const cleared = (type: string, attrs: Record<string, unknown>) => ({
        ...attrs,
        ...Object.fromEntries(lost(type, attrs).map((name) => [name, null])),
      });
      const { tr } = state;
      const found = changedNodes(
        state.doc,
        transactions,
        (node) => node !== state.doc,
      );
      for (const { pos } of found) {
        const node = tr.doc.nodeAt(pos);
        if (!node) {
          continue;
        }
        for (const mark of node.marks) {
          if (!writer.writesMark(mark.type.name)) {
            removeMark(tr, pos, node, mark);
          } else if (lost(mark.type.name, mark.attrs).length > 0) {
            removeMark(tr, pos, node, mark);
            addMark(
              tr,
              pos,
              node,
              mark.type.create(cleared(mark.type.name, mark.attrs)),
            );
          }
        }
        const current = tr.doc.nodeAt(pos) ?? node;
        const type = current.type.name;
        const unwritable = !current.isText && !writer.writesNode(type);
        if (
          current.isText ||
          (!unwritable && lost(type, current.attrs).length === 0)
        ) {
          continue;
        }
        const $pos = tr.doc.resolve(pos);
        const index = $pos.index();
        const fits = (content: readonly ProseMirrorNode[] | null) =>
          content !== null &&
          $pos.parent.canReplace(index, index + 1, Fragment.from(content));
        const read = asDocumentReads(editor, pipeline, current, $pos.parent);
        if (fits(read)) {
          tr.replaceWith(pos, pos + current.nodeSize, read ?? []);
          continue;
        }
        if (unwritable) {
          const content = current.isBlock
            ? blockContentOf(current)
            : contentOf(current);
          if (fits(content)) {
            tr.replaceWith(pos, pos + current.nodeSize, content);
          }
        } else {
          tr.setNodeMarkup(pos, undefined, cleared(type, current.attrs));
        }
      }
      return tr.docChanged ? tr : null;
    },
  });
}

function removeMark(
  tr: Transaction,
  pos: number,
  node: ProseMirrorNode,
  mark: Mark,
): void {
  if (node.isText) {
    tr.removeMark(pos, pos + node.nodeSize, mark);
  } else {
    tr.removeNodeMark(pos, mark);
  }
}

function addMark(
  tr: Transaction,
  pos: number,
  node: ProseMirrorNode,
  mark: Mark,
): void {
  if (node.isText) {
    tr.addMark(pos, pos + node.nodeSize, mark);
  } else {
    tr.addNodeMark(pos, mark);
  }
}

/**
 * A block as the blocks it holds, or as a paragraph of its text: a block
 * that is markdown of its own, like a table of contents, is that markdown.
 */
function blockContentOf(node: ProseMirrorNode): ProseMirrorNode[] {
  const { paragraph } = node.type.schema.nodes;
  if (!node.isLeaf && !node.inlineContent) {
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => {
      children.push(child);
    });
    return children;
  }
  if (node.inlineContent && paragraph) {
    return [paragraph.create(null, node.content)];
  }
  const [text] = contentOf(node);
  return paragraph ? [paragraph.create(null, text ?? null)] : [];
}

/** An inline node as the content it holds, or as its text. */
function contentOf(node: ProseMirrorNode): ProseMirrorNode[] {
  const { schema } = node.type;
  if (node.inlineContent) {
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => {
      children.push(
        child.mark(
          node.marks.reduce((set, mark) => mark.addToSet(set), child.marks),
        ),
      );
    });
    return children;
  }
  const toText = node.type.spec.toText as
    | ((props: { node: ProseMirrorNode }) => string)
    | undefined;
  const text = toText?.({ node }) ?? '';
  return text ? [schema.text(text, node.marks)] : [];
}

export const PubMarkdown = Extension.create<
  PubMarkdownOptions,
  PubMarkdownStorage
>({
  name: 'pubMarkdown',

  addOptions() {
    return {
      notations: [],
      documentRecord: undefined,
      onSetMarkdown: undefined,
    };
  },

  addStorage() {
    return {
      baseline: '',
      documentNotations: null,
      pipelines: new Map(),
      failure: null,
    };
  },

  addExtensions() {
    return this.options.notations.flatMap(
      (notation) => notation.extensions ?? [],
    );
  },

  addProseMirrorPlugins() {
    return [dissolveUnwritable(this.editor)];
  },

  addCommands() {
    return {
      setMarkdown:
        (markdown, options) =>
        ({ commands, dispatch, editor, tr }) => {
          markLoading(tr);
          const { doc } = currentPipeline(editor).parse(markdown);
          const done = commands.setContent(doc.toJSON(), {
            emitUpdate: options?.emitUpdate ?? true,
          });
          if (done && dispatch) {
            const storage = storageOf(editor);
            storage.baseline = markdown;
            storage.documentNotations = null;
            this.options.onSetMarkdown?.(editor);
          }
          return done;
        },
    };
  },
});

export function parseMarkdown(
  editor: Editor,
  markdown: string,
): ParsedMarkdown {
  return currentPipeline(editor).parse(markdown);
}

export interface GetMarkdownOptions {
  /** Compares with this instead of the stored baseline. */
  baseline?: string;
  doc?: ProseMirrorNode;
  /** Frontmatter written instead of the baseline's. */
  frontmatter?: string;
}

/**
 * The document as markdown, with how it was written. See `getMarkdown`.
 */
export function getMarkdownWithResult(
  editor: Editor,
  options: GetMarkdownOptions = {},
): WriteResult {
  const storage = storageOf(editor);
  const record = optionsOf(editor).documentRecord?.(editor);
  if (record) {
    storage.documentNotations =
      record.notations === currentNotations(editor) ? null : record.notations;
  }
  const { pipeline, approximate } =
    options.baseline === undefined
      ? documentPipeline(editor, storage.documentNotations)
      : { pipeline: currentPipeline(editor), approximate: false };
  const doc = options.doc ?? editor.state.doc;
  const baseline = options.baseline ?? storage.baseline;
  const frontmatter = options.frontmatter ?? record?.frontmatter;
  const key = [doc, baseline, pipeline, approximate, frontmatter];
  const { failure } = storage;
  if (failure?.key.every((it, index) => it === key[index])) {
    throw failure.error;
  }
  try {
    const result = pipeline.serializeWithResult(doc, {
      baseline,
      approximate,
      ...(frontmatter !== undefined && { frontmatter }),
    });
    storage.failure = null;
    return result;
  } catch (error) {
    if (error instanceof MarkdownWriteError) {
      storage.failure = { key, error };
    }
    throw error;
  }
}

/**
 * The document as markdown. Blocks that did not change since the baseline
 * keep its source, so saving it changes only the lines that were edited.
 * Throws `MarkdownWriteError` when no markdown reads back as the document;
 * that markdown must not be saved.
 */
export function getMarkdown(
  editor: Editor,
  options: GetMarkdownOptions = {},
): string {
  return getMarkdownWithResult(editor, options).markdown;
}

/**
 * Sets what the document is compared with when it is saved: what was just
 * written, or the file as it is on disk when the document was restored from
 * elsewhere rather than read from it.
 */
export function setMarkdownBaseline(editor: Editor, markdown: string): void {
  storageOf(editor).baseline = markdown;
}

/**
 * Records which definitions the document was made with, as a signature from
 * `currentNotations`; `null` means the current ones.
 */
export function setDocumentNotations(
  editor: Editor,
  signature: string | null,
): void {
  storageOf(editor).documentNotations = signature;
}

/**
 * Reads the document again with the current definitions, through the
 * markdown its own definitions write. Syntax added since then takes effect,
 * and the document is replaced as a whole, so this must run in one client
 * only.
 */
export function upgradeDocumentNotations(editor: Editor): boolean {
  if (storageOf(editor).documentNotations === null) {
    return false;
  }
  return editor.commands.setMarkdown(getMarkdown(editor));
}
