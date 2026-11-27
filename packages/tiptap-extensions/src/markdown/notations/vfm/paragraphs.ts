import { childrenOf, type UnknownMdastNode } from '../../mdast';
import { transformPlugin } from '../../micromark';
import { defineNotation } from '../../notation';

/** The paragraph that a line right after `node` would continue lazily. */
function lastParagraph(
  node: UnknownMdastNode,
): { paragraph: UnknownMdastNode; path: UnknownMdastNode[] } | null {
  const path: UnknownMdastNode[] = [];
  let last: UnknownMdastNode | undefined = node;
  while (last && last.type !== 'paragraph') {
    path.push(last);
    last = childrenOf(last).at(-1);
  }
  return last ? { paragraph: last, path } : null;
}

function sourceOf(node: UnknownMdastNode, source: string): string {
  const { start, end } = node.position ?? {};
  return start?.offset === undefined || end?.offset === undefined
    ? ''
    : source.slice(start.offset, end.offset);
}

/**
 * Whether VFM 2 reads the block as more lines of a paragraph it follows:
 * it lets no ATX heading interrupt one. Nor does it fenced code, which is
 * left a block here, as lines of raw markdown in a paragraph would not
 * survive editing it.
 */
function continues(node: UnknownMdastNode, source: string): boolean {
  return (
    (node.type === 'heading' && /^ {0,3}#/.test(sourceOf(node, source))) ||
    // A paragraph after one continues it too.
    node.type === 'paragraph'
  );
}

/**
 * Turns a setext heading of more than one line into the paragraph VFM 2
 * reads, which takes its underline as text, or ends at it where it is a
 * thematic break. VFM 2 only reads one of a single line.
 */
function readSetext(
  parent: UnknownMdastNode,
  index: number,
  source: string,
): boolean {
  const children = childrenOf(parent);
  const heading = children[index];
  const start = heading?.position?.start;
  const end = heading?.position?.end;
  if (
    heading?.type !== 'heading' ||
    !start ||
    !end ||
    end.line - start.line < 2 ||
    /^ {0,3}#/.test(sourceOf(heading, source))
  ) {
    return false;
  }
  const lineStart = source.lastIndexOf('\n', (end.offset ?? 0) - 1) + 1;
  // Past the prefixes of the containers around, which an underline lacks.
  const prefix = source.slice(lineStart).match(/^[ \t>]*/)?.[0] ?? '';
  const underlineStart = lineStart + prefix.length;
  const underline = source.slice(underlineStart, end.offset);
  const contentEnd = lineStart - 1;
  const lines = {
    line: end.line - 1,
    column: contentEnd - source.lastIndexOf('\n', contentEnd - 1),
    offset: contentEnd,
  };
  const underlinePoint = {
    line: end.line,
    column: prefix.length + 1,
    offset: underlineStart,
  };
  const paragraph: UnknownMdastNode = {
    type: 'paragraph',
    children: childrenOf(heading),
    position: { start, end: lines },
  };
  if (/^ {0,3}(?:-[ \t]*){3,}$/.test(underline)) {
    children.splice(index, 1, paragraph, {
      type: 'thematicBreak',
      position: { start: underlinePoint, end },
    });
    return false;
  }
  paragraph.children = [
    ...childrenOf(heading),
    {
      type: 'text',
      value: '\n',
      position: { start: lines, end: underlinePoint },
    },
    { type: 'vfmLazyLines', position: { start: underlinePoint, end } },
  ];
  paragraph.position = { start, end };
  children[index] = paragraph;
  return true;
}

/**
 * Makes the blocks that VFM 2 reads as more lines of the paragraph before
 * them part of it, as written: headings are kept raw there.
 */
function continueParagraphs(tree: UnknownMdastNode, source: string): void {
  const visit = (parent: UnknownMdastNode) => {
    const children = childrenOf(parent);
    let merged = false;
    for (let index = 0; index < children.length; index++) {
      const read = readSetext(parent, index, source);
      const child = children[index];
      const previous = children[index - 1];
      const found = previous && lastParagraph(previous);
      const line = child.position?.start.line;
      if (
        !found ||
        line === undefined ||
        previous.position?.end.line !== line - 1 ||
        !continues(child, source) ||
        (child.type === 'paragraph' && !merged)
      ) {
        // A paragraph made of a setext heading goes on, as one would.
        merged = read;
        visit(child);
        continue;
      }
      const { paragraph, path } = found;
      const end = child.position?.end;
      const lineEnd = paragraph.position?.end;
      if (!end || !lineEnd || !child.position) {
        merged = false;
        continue;
      }
      paragraph.children = [
        ...childrenOf(paragraph),
        {
          type: 'text',
          value: '\n',
          position: { start: lineEnd, end: child.position.start },
        },
        ...(child.type === 'paragraph'
          ? childrenOf(child)
          : [{ type: 'vfmLazyLines', position: child.position }]),
      ];
      for (const node of [...path, paragraph]) {
        if (node.position) {
          node.position = { start: node.position.start, end };
        }
      }
      children.splice(index, 1);
      index--;
      merged = true;
    }
  };
  visit(tree);
}

/**
 * Paragraphs as VFM 2 reads them, where micromark ends them sooner: at an
 * ATX heading or the underline of a setext heading of more than one line,
 * neither of which ends one in VFM 2.
 */
export const paragraphContinuationNotation = defineNotation({
  name: 'paragraphContinuation',
  version: 1,
  remarkPlugins: [transformPlugin(continueParagraphs)],
  nodes: {
    heading: (node, context, next) => {
      const written = next();
      const lines = written.split('\n');
      if (lines.length <= 2 || /^ {0,3}#/.test(written)) {
        return written;
      }
      // A heading of more lines is one line as ATX, as no setext one is.
      const level = Number(node.attrs.level) || 1;
      const line = context
        .inline(node, { singleLine: true })
        .replaceAll('\n', '&#10;');
      return `${'#'.repeat(level)}${line ? ` ${line}` : ''}`;
    },
  },
});
