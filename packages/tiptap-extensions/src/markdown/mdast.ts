import remarkParse from 'remark-parse';
import { unified } from 'unified';

// `@types/mdast` is only a transitive dependency, so the node types are taken
// from what remark-parse's processor returns.
function createProcessorForTypes() {
  return unified().use(remarkParse);
}

export type MdastRoot = ReturnType<
  ReturnType<typeof createProcessorForTypes>['parse']
>;
export type MdastContent = MdastRoot['children'][number];
export type MdastNode = MdastRoot | MdastContent;
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
