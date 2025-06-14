import type { Editor } from '@tiptap/core';
import { sep } from 'pathe';
import { proxy } from 'valtio';
import { proxyMap } from 'valtio/utils';

declare const contentIdBrand: unique symbol;
export type ContentId = string & { [contentIdBrand]: never };

export interface FileContent {
  format: 'markdown';
  filename: string;
  editor: Editor;
}

export type HierarchicalReadingOrder = [
  string,
  ...(ContentId | HierarchicalReadingOrder)[],
];

export const $content = proxy({
  files: proxyMap<ContentId, FileContent>(),
  readingOrder: [] as ContentId[],

  get hierarchicalReadingOrder(): HierarchicalReadingOrder {
    return this.readingOrder.reduce(
      (acc, contentId) => {
        const file = this.files.get(contentId);
        if (!file) {
          return acc;
        }
        const { filename } = file;
        const segments = filename.split(sep);
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
      ['.'] as HierarchicalReadingOrder,
    );
  },
});
