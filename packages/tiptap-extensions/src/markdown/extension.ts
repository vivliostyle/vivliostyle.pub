import { type Editor, Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import {
  createLegacyBaselineReader,
  type LegacyBaselineReader,
} from './legacy';
import type { NotationDefinition } from './notation';
import {
  type BaselineReader,
  MarkdownPipeline,
  notationSignature,
  type ParsedMarkdown,
} from './pipeline';
import type { WriteResult } from './write';

/**
 * Stands for the definitions of the marked-based parser the editor used
 * before remark, for documents made back then.
 */
export const MARKED_NOTATIONS = 'marked';

export interface PubMarkdownOptions {
  notations: NotationDefinition[];
  /**
   * The definitions that write documents made with marked, by name. They
   * have to stay the set that was in use when the editor moved to remark,
   * or text in old documents would be escaped for syntax added since.
   */
  markedEraNotations?: readonly string[] | undefined;
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
   * The definitions the document was made with, as a signature or
   * `MARKED_NOTATIONS`, when they are not the current ones.
   */
  documentNotations: string | null;
  pipelines: Map<string, MarkdownPipeline>;
  legacyReader: LegacyBaselineReader | null;
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

function pipelineFor(
  editor: Editor,
  names: readonly string[] | null,
): MarkdownPipeline {
  const storage = storageOf(editor);
  const all = optionsOf(editor).notations;
  const notations = names
    ? all.filter((notation) => names.includes(notation.name))
    : all;
  const signature = notationSignature(notations);
  let pipeline = storage.pipelines.get(signature);
  if (!pipeline) {
    pipeline = new MarkdownPipeline(editor.schema, notations);
    storage.pipelines.set(signature, pipeline);
  }
  return pipeline;
}

function currentPipeline(editor: Editor): MarkdownPipeline {
  return pipelineFor(editor, null);
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
 * The pipeline that writes the document the way it was read, and how to read
 * its baseline: a document keeps meaning what it meant when it was made.
 */
function documentPipeline(editor: Editor): {
  pipeline: MarkdownPipeline;
  reader: BaselineReader | null;
} {
  const storage = storageOf(editor);
  const signature = storage.documentNotations;
  if (signature === null || signature === currentNotations(editor)) {
    return { pipeline: currentPipeline(editor), reader: null };
  }
  if (signature === MARKED_NOTATIONS) {
    storage.legacyReader ??= createLegacyBaselineReader(
      editor.schema,
      editor.extensionManager.extensions,
    );
    return {
      pipeline: pipelineFor(
        editor,
        optionsOf(editor).markedEraNotations ?? null,
      ),
      reader: storage.legacyReader,
    };
  }
  // A definition the document was made with that is no longer there cannot
  // be brought back; the ones still there are used at their current version.
  const names = signature.split(' ').map((entry) => entry.split('@')[0]);
  return { pipeline: pipelineFor(editor, names), reader: null };
}

export const PubMarkdown = Extension.create<
  PubMarkdownOptions,
  PubMarkdownStorage
>({
  name: 'pubMarkdown',

  addOptions() {
    return {
      notations: [],
      markedEraNotations: undefined,
      onSetMarkdown: undefined,
    };
  },

  addStorage() {
    return {
      baseline: '',
      documentNotations: null,
      pipelines: new Map(),
      legacyReader: null,
    };
  },

  addExtensions() {
    return this.options.notations.flatMap(
      (notation) => notation.extensions ?? [],
    );
  },

  addCommands() {
    return {
      setMarkdown:
        (markdown, options) =>
        ({ commands, dispatch, editor }) => {
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
  const { pipeline, reader } =
    options.baseline === undefined
      ? documentPipeline(editor)
      : { pipeline: currentPipeline(editor), reader: null };
  return pipeline.serializeWithResult(options.doc ?? editor.state.doc, {
    baseline: options.baseline ?? storage.baseline,
    baselineReader: reader,
    ...(options.frontmatter !== undefined && {
      frontmatter: options.frontmatter,
    }),
  });
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
 * `currentNotations` or `MARKED_NOTATIONS`; `null` means the current ones.
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
