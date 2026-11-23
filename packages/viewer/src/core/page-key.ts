/** Identifies a page across re-layouts, the way core addresses it. */
export interface PageKey {
  spineIndex: number;
  /** Index within the spine item. */
  pageIndex: number;
}

export function pageKeyId({ spineIndex, pageIndex }: PageKey): string {
  return `${spineIndex}:${pageIndex}`;
}
