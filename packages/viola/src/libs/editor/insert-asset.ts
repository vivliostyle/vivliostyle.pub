import type { Editor } from '@tiptap/core';
import { dirname, relative } from 'pathe';

import { $content } from '../../stores/accessors';
import type { ContentId } from '../../stores/proxies/content';
import { Sandbox } from '../../stores/proxies/sandbox';

export interface InsertExistingAssetOptions {
  editor: Editor;
  contentId: ContentId;
  assetPath: string;
  pos?: number;
}

export function insertExistingAsset({
  editor,
  contentId,
  assetPath,
  pos,
}: InsertExistingAssetOptions): void {
  const category = Sandbox.categorizeAsset(assetPath);
  if (category !== 'image') {
    return;
  }
  const fileContent = $content.valueOrThrow().files.get(contentId);
  if (!fileContent) {
    return;
  }
  const dir = dirname(fileContent.filename);
  const relSrc = relative(dir, assetPath);

  let chain = editor.chain().focus();
  if (pos !== undefined) {
    chain = chain.setTextSelection(pos);
  }
  chain.setImage({ src: relSrc }).scrollIntoView().run();
}
