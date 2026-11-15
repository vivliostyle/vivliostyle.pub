import type { JSONContent } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';

// Conservative subset of what both marked and VFM (remark-parse with `gfm`)
// autolink: no characters they treat specially at the edges or inside.
const BARE_URL_RE = /^https?:\/\/[^\s<>&"'`\\()[\]{}]+$/i;
const TRIMMED_TRAILING_RE = /[.,:;!?*_~]$/;

function isPlainText(node: JSONContent | undefined): node is JSONContent {
  return node?.type === 'text' && !node.marks?.length;
}

function isBareUrlLink(node: JSONContent): boolean {
  if (node.type !== 'text' || node.marks?.length !== 1) {
    return false;
  }
  const [mark] = node.marks;
  const text = node.text ?? '';
  return (
    mark?.type === 'link' &&
    !mark.attrs?.title &&
    mark.attrs?.href === text &&
    BARE_URL_RE.test(text) &&
    !TRIMMED_TRAILING_RE.test(text)
  );
}

function isBoundaryBefore(prev: JSONContent | undefined): boolean {
  if (!prev || prev.type === 'hardBreak') {
    return true;
  }
  return isPlainText(prev) && /\s$/.test(prev.text ?? '');
}

function isBoundaryAfter(
  next: JSONContent | undefined,
  afterNext: JSONContent | undefined,
): boolean {
  if (!next || next.type === 'hardBreak') {
    return true;
  }
  if (!isPlainText(next)) {
    return false;
  }
  const text = next.text ?? '';
  if (/^\s/.test(text)) {
    return true;
  }
  // Parsers drop one sentence mark from the end of a URL, so "url." still
  // links only "url" as long as nothing else is glued on after the mark.
  if (/^[.,:;!?]\s/.test(text)) {
    return true;
  }
  return (
    /^[.,:;!?]$/.test(text) && (!afterNext || afterNext.type === 'hardBreak')
  );
}

/**
 * Drops the link mark from links whose text is their own URL where the bare
 * URL autolinks back to the same link, so they serialize as `https://…`
 * instead of `[https://…](https://…)`.
 */
export function unlinkBareUrls(content: JSONContent): JSONContent {
  const children = content.content;
  if (!children) {
    return content;
  }
  return {
    ...content,
    content: children.map((child, index) => {
      if (
        isBareUrlLink(child) &&
        isBoundaryBefore(children[index - 1]) &&
        isBoundaryAfter(children[index + 1], children[index + 2])
      ) {
        const { marks: _marks, ...plain } = child;
        return plain;
      }
      return unlinkBareUrls(child);
    }),
  };
}

// marked parses a bare URL into a link whose text is the URL, and the Link
// extension writes every link back as `[text](href)`, so without this a bare
// URL is rewritten the first time the document is saved.
export const PubMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    const manager = this.editor.markdown;
    if (!manager) {
      return;
    }
    const serialize = manager.serialize.bind(manager);
    manager.serialize = (content) => serialize(unlinkBareUrls(content));
  },
});
