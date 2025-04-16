import type { Extensions } from '@tiptap/react';
import { proxy, ref } from 'valtio';
import type * as Y from 'yjs';

declare const contentIdBrand: unique symbol;
export type ContentId = string & { [contentIdBrand]: never };

export interface FileContent {
  path: string;
  json: object;
}

export type HierarchicalReadingOrder = [
  string,
  ...(ContentId | HierarchicalReadingOrder)[],
];

export const rootChar = '.';
export const separatorChar = '/';

export const content = proxy({
  editor: ref<
    Record<
      ContentId,
      {
        doc: Y.Doc;
        extensions: Extensions;
      }
    >
  >({}),
  files: {} as Record<ContentId, FileContent>,
  readingOrder: [] as ContentId[],

  get hierarchicalReadingOrder(): HierarchicalReadingOrder {
    return this.readingOrder.reduce(
      (acc, contentId) => {
        const { path } = this.files[contentId];
        const segments = path.split(separatorChar);
        let current = acc;
        for (const n of segments) {
          const tail = current.at(-1) as string | HierarchicalReadingOrder;
          if (Array.isArray(tail) && tail[0] === n) {
            current = tail;
          } else {
            const next = [n] satisfies HierarchicalReadingOrder;
            current.push(next);
            current = next;
          }
        }
        current.push(contentId);
        return acc;
      },
      [rootChar] as HierarchicalReadingOrder,
    );
  },
});
