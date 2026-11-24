// Mirrors VFM (remark-frontmatter): blank lines before the opening fence are
// allowed, the opening fence must be exactly `---` on its own line, and the
// closing fence is the first subsequent line starting with `---` (anything
// after those dashes is left in the source, as VFM does).
const FRONTMATTER_RE =
  /^(?:[ \t]*\n)*---\n(?:[\s\S]*?\n)?---(?:(?:[ \t]*\n)+|[ \t]*$)?/;

export interface SplitSource {
  /** The frontmatter with its fences and the blank lines after it. */
  frontmatter: string;
  body: string;
  /** The line ending the source was written with. */
  eol: '\n' | '\r\n';
}

/** Splits markdown into frontmatter and body, with line endings as `\n`. */
export function splitSource(markdown: string): SplitSource {
  const crlf = markdown.match(/\r\n/g)?.length ?? 0;
  const lf = markdown.match(/\n/g)?.length ?? 0;
  const eol = crlf > 0 && crlf * 2 >= lf ? '\r\n' : '\n';
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const frontmatter = normalized.match(FRONTMATTER_RE)?.[0] ?? '';
  return { frontmatter, body: normalized.slice(frontmatter.length), eol };
}

export function joinSource(
  { frontmatter, eol }: Omit<SplitSource, 'body'>,
  body: string,
): string {
  const markdown = frontmatter + body;
  return eol === '\n' ? markdown : markdown.replaceAll('\n', eol);
}

export function startsWithFrontmatterFence(markdown: string): boolean {
  return FRONTMATTER_RE.test(markdown);
}

/**
 * Moves past the prefix a container puts at the start of each of its lines,
 * from `index` in `line`. Returns where the container's content starts, or
 * `null` when the line does not carry the prefix (a lazy continuation line).
 */
export type LinePrefix = (line: string, index: number) => number | null;

export const quotePrefix: LinePrefix = (line, index) => {
  let i = index;
  while (i < index + 3 && line[i] === ' ') {
    i++;
  }
  if (line[i] !== '>') {
    return null;
  }
  i++;
  return line[i] === ' ' || line[i] === '\t' ? i + 1 : i;
};

/** The prefix of a list item whose content starts at `column` (0-based). */
export function itemPrefix(column: number): LinePrefix {
  return (line, index) => {
    let i = index;
    while (i < column && (line[i] === ' ' || line[i] === '\t')) {
      i++;
    }
    return i === column || i === line.length ? i : null;
  };
}

/**
 * Removes the prefixes of the containers around a slice of the source from
 * every line but the first, which starts inside them already.
 */
export function stripPrefixes(
  text: string,
  prefixes: readonly LinePrefix[],
): string {
  if (prefixes.length === 0 || !text.includes('\n')) {
    return text;
  }
  const [first, ...rest] = text.split('\n');
  const stripped = rest.map((line) => {
    let index = 0;
    for (const prefix of prefixes) {
      const next = prefix(line, index);
      if (next === null) {
        break;
      }
      index = next;
    }
    return line.slice(index);
  });
  return [first, ...stripped].join('\n');
}
