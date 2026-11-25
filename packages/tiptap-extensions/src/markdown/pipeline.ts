import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import { baseDocumentOf } from './base';
import type { NotationDefinition } from './notation';
import { MarkdownParser, type ParsedBody } from './parse';
import { joinSource, splitSource } from './source';
import { MarkdownWriter, type WriteResult } from './write';

export interface ParsedMarkdown {
  doc: ProseMirrorNode;
  /** The frontmatter with its fences, or an empty string. */
  frontmatter: string;
}

export interface SerializeOptions {
  /**
   * The markdown the document was last read from or written as. Unchanged
   * blocks keep its source, and frontmatter, line endings and the trailing
   * newline come from it.
   */
  baseline?: string;
  /** Frontmatter written instead of the baseline's. */
  frontmatter?: string;
  /**
   * The document was read with definitions that are not quite these, e.g.
   * other versions of them. Reading the output back cannot prove it right,
   * so only blocks written anew are checked and text that was not edited
   * stays as written.
   */
  approximate?: boolean;
}

/** Names and versions of the definitions a document was read with. */
export function notationSignature(
  notations: readonly NotationDefinition[],
): string {
  return notations
    .map((notation) => `${notation.name}@${notation.version ?? 1}`)
    .join(' ');
}

const CACHE_SIZE = 4;

/** Converts between markdown and documents of one schema. */
export class MarkdownPipeline {
  readonly parser: MarkdownParser;
  readonly writer: MarkdownWriter;
  readonly signature: string;
  private readonly cache = new Map<string, ParsedBody>();

  constructor(schema: Schema, notations: readonly NotationDefinition[]) {
    this.parser = new MarkdownParser(schema, notations);
    this.writer = new MarkdownWriter(this.parser, notations);
    this.signature = notationSignature(notations);
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

  /**
   * Writes the document as markdown that reads back as it. Throws
   * `MarkdownWriteError` when no markdown the writer can make does.
   */
  serialize(doc: ProseMirrorNode, options: SerializeOptions = {}): string {
    return this.serializeWithResult(doc, options).markdown;
  }

  serializeWithResult(
    doc: ProseMirrorNode,
    options: SerializeOptions = {},
  ): WriteResult {
    const source = splitSource(options.baseline ?? '');
    const frontmatter = options.frontmatter ?? source.frontmatter;
    const parsed = this.parseBody(source.body);
    const base = baseDocumentOf(parsed);
    // A file of frontmatter alone may end at its closing fence.
    const head = (body: string) =>
      frontmatter && body && !frontmatter.endsWith('\n')
        ? `${frontmatter}\n`
        : frontmatter;
    const join = (body: string) => head(body) + body;
    const result = this.writer.writeBody(doc, base, parsed.styles, {
      bareStart: !frontmatter,
      // The whole file is read back, so a body that would start frontmatter
      // of its own is caught too. An unchanged body is parsed already.
      check: options.approximate
        ? null
        : (body, layout) => {
            const read = splitSource(join(body));
            const readBody = this.parseBody(read.body);
            if (read.body !== body) {
              const first = this.writer.difference(readBody.doc, doc);
              return new Set(first === -1 ? [] : [first]);
            }
            return this.writer.differences(readBody, doc, layout);
          },
    });
    return {
      ...result,
      markdown: joinSource(
        { ...source, frontmatter: head(result.markdown) },
        result.markdown,
      ),
    };
  }
}
