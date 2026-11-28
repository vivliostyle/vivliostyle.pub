import type { CompileContext } from 'mdast-util-from-markdown';
import type { Token } from 'micromark-util-types';

import type { UnknownMdastNode } from '../../mdast';
import { currentNode, enterNode } from '../../micromark';

/**
 * What is written between two constructs that VFM would read as one, such
 * as math right after math: an empty HTML comment, which renders as nothing
 * and which the editor reads as no content.
 */
export const SEPARATOR = '<!---->';

/**
 * Enters `node` for `token`. A separator right before it, after a node that
 * `separates` takes, is no content: it goes into the source of `node`, where
 * it is kept with the node as written.
 */
export function enterSeparated(
  context: CompileContext,
  node: UnknownMdastNode & Record<string, unknown>,
  token: Token,
  separates: (before: UnknownMdastNode) => boolean,
): void {
  const children = currentNode(context).children ?? [];
  const [before, separator] = children.slice(-2);
  const found =
    children.length >= 2 &&
    before &&
    separates(before) &&
    separator?.type === 'html' &&
    separator.value === SEPARATOR &&
    separator.position?.start.offset === before.position?.end.offset &&
    separator.position?.end.offset === token.start.offset
      ? separator
      : null;
  if (found) {
    children.pop();
  }
  enterNode(context, node, token);
  const entered = currentNode(context);
  if (found?.position && entered.position) {
    entered.position.start = { ...found.position.start };
  }
}
