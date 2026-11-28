import { Strike } from '@tiptap/extension-strike';
import { Underline } from '@tiptap/extension-underline';
import type { Mark } from '@tiptap/pm/model';
import remarkGfm from 'remark-gfm';

import type { MdastNodeOf } from '../mdast';
import {
  declareNotation,
  defineNotation,
  type NotationDefinition,
  type ParseContext,
} from '../notation';

// VFM renders strikethrough as `del`, which themes style.
const PubStrike = Strike.extend({
  renderHTML({ HTMLAttributes }) {
    return ['del', HTMLAttributes, 0];
  },
});

// GFM finds no links in the text of a link.
function inLink(marks: readonly Mark[]): boolean {
  return marks.some((mark) => mark.type.name === 'link');
}

// Up to the first character no domain holds, labels separated by dots, of
// which only the last may be empty, where other characters follow.
function hasDottedDomain(rest: string): boolean {
  const domain = rest.match(/^[\w.-]*/)?.[0] ?? '';
  return /^[\w-]+(?:\.[\w-]+)*\.[\w-]*$/.test(domain);
}

/**
 * Whether a link GFM found in text is one VFM finds too: a URL or a `www.`
 * address whose domain has a dot, where micromark takes any domain.
 */
function isDottedAutolink(
  node: MdastNodeOf<'link'>,
  context: ParseContext,
): boolean {
  // A link made by a transform rather than read is found in text.
  const written = node.position ? context.source(node) : '';
  const [child] = node.children;
  if (
    /^[[<]/.test(written) ||
    node.children.length !== 1 ||
    child?.type !== 'text'
  ) {
    return true;
  }
  const text = child.value;
  const scheme = text.match(/^[a-z][a-z0-9+.-]*:\/\//i)?.[0];
  if (scheme) {
    return hasDottedDomain(text.slice(scheme.length));
  }
  if (/^www\./i.test(text)) {
    return text.startsWith('www.') && hasDottedDomain(text.slice(4));
  }
  return true;
}

/**
 * GitHub Flavored Markdown as VFM reads it. Tables, task list checkboxes and
 * footnote definitions have no definition yet and are kept as raw markdown.
 */
export function gfmNotations({
  singleTilde,
  dottedDomains,
}: {
  /** `~a~` is strikethrough as well as `~~a~~`. */
  singleTilde: boolean;
  /** A URL or a `www.` address in text is a link only where its domain has a dot. */
  dottedDomains: boolean;
}): NotationDefinition[] {
  // Versions 1 and 2 linked any domain.
  const version = (single: boolean, dotted: boolean) =>
    (single ? 1 : 2) + (dotted ? 2 : 0);
  const gfm = (single: boolean, dotted: boolean) =>
    defineNotation({
      name: 'gfm',
      version: version(single, dotted),
      remarkPlugins: [[remarkGfm, { singleTilde: single }]],
      ...(dotted && {
        fromMarkdown: {
          link: (node, context, next) =>
            isDottedAutolink(node, context) ? next() : context.inlines(node),
        },
      }),
      escapes: [
        // A row of cells needs pipes.
        { pattern: /\|/g },
        // A URL that GFM links takes in what follows it, escapes included, so
        // it is ended with an explicit link instead. Text that GFM autolinks
        // cannot be escaped out of it: the links are found in the text after
        // escapes are read.
        {
          pattern: /(?<![A-Za-z0-9])https?:\/\/[^\s<>]*[^\s<>.,:;!?'"*_~)]/gi,
          enclose: (url, marks) => (inLink(marks) ? null : `<${url}>`),
        },
        {
          pattern: /(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
          enclose: (address, marks) => (inLink(marks) ? null : `<${address}>`),
        },
        // Link text is markdown, so only what holds nothing to escape.
        {
          pattern:
            /(?<![A-Za-z0-9])www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?:\/[A-Za-z0-9/%=+-]*)?/gi,
          enclose: (domain, marks) =>
            inLink(marks) ? null : `[${domain}](http://${domain})`,
        },
      ],
    });
  const current = gfm(singleTilde, dottedDomains);
  const earlier = [gfm(true, false), gfm(false, false), gfm(true, true)].filter(
    (it) => (it.version ?? 0) < (current.version ?? 0),
  );
  return [
    // Versions 1 and 3 read `~a~` as strikethrough.
    earlier.length > 0 ? { ...current, earlier } : current,
    declareNotation(
      {
        kind: 'delimitedMark',
        name: 'strikethrough',
        mark: 'strike',
        mdastType: 'delete',
        delimiter: '~~',
        tag: 'del',
      },
      [PubStrike],
    ),
  ];
}

/** HTML elements that markdown has no syntax for, written as tags. */
export const htmlMarkNotations: NotationDefinition[] = [
  declareNotation(
    { kind: 'htmlMark', name: 'underline', mark: 'underline', tag: 'u' },
    [Underline],
  ),
];
