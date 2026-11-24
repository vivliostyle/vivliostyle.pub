import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import { type BaseDocument, baseDocumentOf } from './base';
import type { NotationDefinition } from './notation';
import { MarkdownParser, type ParsedBody } from './parse';
import { joinSource, splitSource } from './source';
import { MarkdownWriter } from './write';

export interface ParsedMarkdown {
  doc: ProseMirrorNode;
  /** The frontmatter with its fences, or an empty string. */
  frontmatter: string;
}

/** Reads the baseline the way the document was read when it was made. */
export interface BaselineReader {
  read(body: string): BaseDocument | null;
}

export interface SerializeOptions {
  /**
   * The markdown the document was last read from or written as. Unchanged
   * blocks keep its source, and frontmatter, line endings and the trailing
   * newline come from it.
   */
  baseline?: string;
  /** Reads the baseline instead of the pipeline's own parser. */
  baselineReader?: BaselineReader | null;
}

const CACHE_SIZE = 4;

/** Converts between markdown and documents of one schema. */
export class MarkdownPipeline {
  readonly parser: MarkdownParser;
  readonly writer: MarkdownWriter;
  private readonly cache = new Map<string, ParsedBody>();

  constructor(schema: Schema, notations: readonly NotationDefinition[]) {
    this.parser = new MarkdownParser(schema, notations);
    this.writer = new MarkdownWriter(this.parser, notations, (body) =>
      this.parseBody(body),
    );
  }

  /** Bodies are parsed once: a save reads back what the next save diffs. */
  parseBody(body: string): ParsedBody {
    const cached = this.cache.get(body);
    if (cached) {
      this.cache.delete(body);
      this.cache.set(body, cached);
      return cached;
    }
    const parsed = this.parser.parseBody(body);
    this.cache.set(body, parsed);
    if (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    return parsed;
  }

  parse(markdown: string): ParsedMarkdown {
    const { frontmatter, body } = splitSource(markdown);
    return { doc: this.parseBody(body).doc, frontmatter };
  }

  serialize(doc: ProseMirrorNode, options: SerializeOptions = {}): string {
    const source = splitSource(options.baseline ?? '');
    const parsed = this.parseBody(source.body);
    const base = options.baselineReader
      ? options.baselineReader.read(source.body)
      : baseDocumentOf(parsed);
    const body = this.writer.writeBody(doc, base, parsed.styles, {
      // Blocks reused from a baseline read the old way can mean something
      // else to the current parser, so only the blocks written anew are
      // checked.
      checkWhole: !options.baselineReader,
      bareStart: !source.frontmatter,
      baseline: source.body,
    });
    return joinSource(source, body);
  }
}
