import { matchSequences } from './match';

// Mirrors VFM (remark-frontmatter): blank lines before the opening fence are
// allowed, the opening fence must be exactly `---` on its own line, and the
// closing fence is the first subsequent line starting with `---` (anything
// after those dashes is left in the source, as VFM does).
const FRONTMATTER_RE =
  /^(?:[ \t]*\n)*---\n(?:[\s\S]*?\n)?---(?:(?:[ \t]*\n)+|[ \t]*$)?/;

const BOM = '\uFEFF';

export interface SplitSource {
  /** The frontmatter with its fences and the blank lines after it. */
  frontmatter: string;
  body: string;
  /** The line ending the source uses most. */
  eol: '\n' | '\r\n';
  bom: boolean;
  /** The source as it was given, for the line endings of its lines. */
  original: string;
}

/** Splits markdown into frontmatter and body, with line endings as `\n`. */
export function splitSource(markdown: string): SplitSource {
  const bom = markdown.startsWith(BOM);
  const text = bom ? markdown.slice(1) : markdown;
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = text.match(/\n/g)?.length ?? 0;
  const eol = crlf > 0 && crlf * 2 >= lf ? '\r\n' : '\n';
  const normalized = text.replace(/\r\n?/g, '\n');
  const frontmatter = normalized.match(FRONTMATTER_RE)?.[0] ?? '';
  return {
    frontmatter,
    body: normalized.slice(frontmatter.length),
    eol,
    bom,
    original: text,
  };
}

/**
 * Joins frontmatter and body, giving each line that was already in the
 * source the line ending it had there and new lines the one used most.
 */
export function joinSource(
  { frontmatter, eol, bom, original }: Omit<SplitSource, 'body'>,
  body: string,
): string {
  const markdown = frontmatter + body;
  const lines = markdown.split('\n');
  let joined: string;
  if (!original.includes('\r')) {
    joined = eol === '\n' ? markdown : lines.join(eol);
  } else {
    const originalLines = [...original.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)]
      .filter((match) => match[0] !== '' || match.index < original.length)
      .map((match) => ({ text: match[1], ending: match[2] }));
    const matches = matchSequences(
      lines,
      originalLines.map((line) => line.text),
    );
    joined = lines
      .map((line, index) => {
        if (index === lines.length - 1) {
          return line;
        }
        const ending = originalLines[matches[index]]?.ending;
        return line + (ending || eol);
      })
      .join('');
  }
  return bom ? BOM + joined : joined;
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
