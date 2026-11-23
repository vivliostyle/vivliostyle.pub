import type { CoreViewer } from '@vivliostyle/core';

import { type PageKey, pageKeyId } from './page-key';

/**
 * Ids (see `pageKeyId`) of the pages the references were laid out on, read
 * from core's map of references by target id; null when it is not shaped
 * as expected.
 */
export function referringPages(references: unknown): Set<string> | null {
  if (typeof references !== 'object' || references === null) {
    return null;
  }
  const pages = new Set<string>();
  for (const refs of Object.values(references)) {
    if (!Array.isArray(refs)) {
      return null;
    }
    for (const ref of refs) {
      const { spineIndex, pageIndex } = (ref ?? {}) as Partial<PageKey>;
      if (typeof spineIndex === 'number' && typeof pageIndex === 'number') {
        pages.add(pageKeyId({ spineIndex, pageIndex }));
      }
    }
  }
  return pages;
}

let warned = false;

/**
 * Ids of the pages that core is to lay out again once it has laid out the
 * targets of their references, such as a table of contents that shows page
 * numbers; until then they show placeholders. Not part of core's API: none
 * when core's internals are not as expected.
 */
export function pagesAwaitingTargets(viewer: CoreViewer): Set<string> {
  let pages: Set<string> | null;
  try {
    const adaptViewer = (
      viewer as unknown as {
        adaptViewer_?: {
          opfView?: { counterStore?: { unresolvedReferences?: unknown } };
        };
      }
    ).adaptViewer_;
    // Nothing is laid out before the first load.
    if (adaptViewer && !adaptViewer.opfView) {
      return new Set();
    }
    pages = referringPages(
      adaptViewer?.opfView?.counterStore?.unresolvedReferences,
    );
  } catch {
    pages = null;
  }
  if (!pages) {
    if (!warned) {
      warned = true;
      console.warn('Cannot read the references of @vivliostyle/core');
    }
    return new Set();
  }
  return pages;
}
