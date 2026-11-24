import type {
  DOMOutputSpec,
  Mark,
  Node as ProseMirrorNode,
} from '@tiptap/pm/model';

// Elements that HTML writes without a closing tag.
const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr']);

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function isAttributes(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !('nodeType' in value)
  );
}

/**
 * The HTML of a DOM output spec, with `content` in its hole. A spec that
 * holds DOM nodes cannot be written without a DOM.
 */
function writeSpec(spec: DOMOutputSpec, content: () => string): string {
  if (typeof spec === 'string') {
    return escapeText(spec);
  }
  if (!Array.isArray(spec)) {
    throw new Error('A DOM output spec with DOM nodes needs a DOM');
  }
  const [name, ...rest] = spec as readonly unknown[];
  const tag = String(name).split(' ').at(-1) ?? '';
  let children = rest;
  let attributes = '';
  if (isAttributes(rest[0])) {
    children = rest.slice(1);
    for (const [key, value] of Object.entries(rest[0])) {
      if (value !== null && value !== undefined) {
        attributes += ` ${key}="${escapeAttribute(String(value))}"`;
      }
    }
  }
  const inner = children
    .map((child) =>
      child === 0 ? content() : writeSpec(child as DOMOutputSpec, content),
    )
    .join('');
  return VOID.has(tag) && !inner
    ? `<${tag}${attributes}>`
    : `<${tag}${attributes}>${inner}</${tag}>`;
}

const HOLE = '\u0001';

function markTags(mark: Mark): [string, string] {
  const toDOM = mark.type.spec.toDOM;
  if (!toDOM) {
    return ['', ''];
  }
  const [open = '', close = ''] = writeSpec(
    toDOM(mark, true),
    () => HOLE,
  ).split(HOLE);
  return [open, close];
}

/** The inline content of a node, with marks nested as ProseMirror nests them. */
function writeInline(parent: ProseMirrorNode): string {
  const active: { mark: Mark; close: string }[] = [];
  let html = '';
  parent.forEach((child) => {
    let keep = 0;
    while (
      keep < active.length &&
      keep < child.marks.length &&
      child.marks[keep].eq(active[keep].mark)
    ) {
      keep++;
    }
    while (active.length > keep) {
      html += active.pop()?.close ?? '';
    }
    for (const mark of child.marks.slice(keep)) {
      const [open, close] = markTags(mark);
      html += open;
      active.push({ mark, close });
    }
    html += child.isText ? escapeText(child.text ?? '') : writeNode(child);
  });
  while (active.length > 0) {
    html += active.pop()?.close ?? '';
  }
  return html;
}

function writeNode(node: ProseMirrorNode): string {
  const toDOM = node.type.spec.toDOM;
  if (!toDOM) {
    throw new Error(`The ${node.type.name} node has no DOM output`);
  }
  return writeSpec(toDOM(node), () =>
    node.inlineContent
      ? writeInline(node)
      : node.content.content.map(writeNode).join(''),
  );
}

/**
 * The HTML the schema's DOM output makes of a document's content, written
 * without a DOM, as the editor would put it on the page.
 */
export function documentHtml(doc: ProseMirrorNode): string {
  return doc.content.content.map(writeNode).join('');
}
