import type { Nodes, Root, RootContent } from 'mdast';

export type MdastRoot = Root;
export type MdastContent = RootContent;
export type MdastNode = Nodes;
export type MdastType = MdastNode['type'];
export type MdastNodeOf<T extends string> = Extract<MdastNode, { type: T }>;
export type MdastPosition = NonNullable<MdastRoot['position']>;

/**
 * Any mdast node, including those of syntax extensions whose types the
 * pipeline does not know.
 */
export interface UnknownMdastNode {
  type: string;
  position?: MdastPosition | undefined;
  children?: UnknownMdastNode[];
  value?: string;
}

export function childrenOf(node: UnknownMdastNode): UnknownMdastNode[] {
  return node.children ?? [];
}
