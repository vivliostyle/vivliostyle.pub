import { type Editor, Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { createLegacyBaselineReader } from './legacy';
import type { NotationDefinition } from './notation';
import {
  type BaselineReader,
  MarkdownPipeline,
  type ParsedMarkdown,
} from './pipeline';

export interface PubMarkdownOptions {
  notations: NotationDefinition[];
  /** Called after `setMarkdown` has replaced the document. */
  onSetMarkdown?: ((editor: Editor) => void) | undefined;
}

export interface PubMarkdownStorage {
  /**
   * The markdown the document was last read from or written as. Saving
   * reuses its source for whatever did not change.
   */
  baseline: string;
  /** Whether the document was made by the parser used before remark. */
  legacy: boolean;
  pipeline: MarkdownPipeline | null;
  legacyReader: BaselineReader | null;
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

function pipelineOf(editor: Editor): MarkdownPipeline {
  const storage = storageOf(editor);
  storage.pipeline ??= new MarkdownPipeline(
    editor.schema,
    editor.extensionManager.extensions.find(
      (extension) => extension.name === 'pubMarkdown',
    )?.options.notations ?? [],
  );
  return storage.pipeline;
}

export const PubMarkdown = Extension.create<
  PubMarkdownOptions,
  PubMarkdownStorage
>({
  name: 'pubMarkdown',

  addOptions() {
    return { notations: [], onSetMarkdown: undefined };
  },

  addStorage() {
    return {
      baseline: '',
      legacy: false,
      pipeline: null,
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
          const { doc } = pipelineOf(editor).parse(markdown);
          const done = commands.setContent(doc.toJSON(), {
            emitUpdate: options?.emitUpdate ?? true,
          });
          if (done && dispatch) {
            const storage = storageOf(editor);
            storage.baseline = markdown;
            storage.legacy = false;
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
  return pipelineOf(editor).parse(markdown);
}

/**
 * The document as markdown. Blocks that did not change since the baseline
 * keep its source, so saving it changes only the lines that were edited.
 */
export function getMarkdown(
  editor: Editor,
  options: { baseline?: string; doc?: ProseMirrorNode } = {},
): string {
  const storage = storageOf(editor);
  const baseline = options.baseline ?? storage.baseline;
  let reader: BaselineReader | null = null;
  if (storage.legacy && options.baseline === undefined) {
    storage.legacyReader ??= createLegacyBaselineReader(
      editor.schema,
      editor.extensionManager.extensions,
    );
    reader = storage.legacyReader;
  }
  return pipelineOf(editor).serialize(options.doc ?? editor.state.doc, {
    baseline,
    baselineReader: reader,
  });
}

/**
 * Sets what the document is compared with when it is saved: what was just
 * written, or the file as it is on disk when the document was restored from
 * elsewhere rather than read from it. `legacy` marks a document made before
 * the editor moved to remark.
 */
export function setMarkdownBaseline(
  editor: Editor,
  markdown: string,
  options: { legacy?: boolean } = {},
): void {
  const storage = storageOf(editor);
  storage.baseline = markdown;
  if (options.legacy !== undefined) {
    storage.legacy = options.legacy;
  }
}
