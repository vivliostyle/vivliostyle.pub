import type { Editor } from '@tiptap/core';
import { sep } from 'pathe';
import { proxy, ref } from 'valtio';
import { proxyMap } from 'valtio/utils';

import type { Project } from './project';

declare const contentIdBrand: unique symbol;
export type ContentId = string & { [contentIdBrand]: never };

export interface FileContent {
  format: 'markdown';
  filename: string;
  summary: string;
  editor: Editor;
}

export type HierarchicalReadingOrder = [
  string,
  ...(ContentId | HierarchicalReadingOrder)[],
];

export class Content {
  static create(project: Project) {
    return proxy(new Content(project));
  }

  files = proxyMap<ContentId, FileContent>();
  readingOrder: ContentId[] = [];

  protected project: Project;

  protected constructor(project: Project) {
    this.project = ref(project);
  }

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
  }

  getFileByFilename(filename: string): [ContentId, FileContent] | undefined {
    for (const [contentId, file] of this.files.entries()) {
      if (file.filename === filename) {
        return [contentId, file];
      }
    }
  }
}
