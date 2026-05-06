import type { Editor } from '@tiptap/core';
import { relative } from 'pathe';

import { Sandbox } from '../../stores/proxies/sandbox';

export interface InsertExistingAssetOptions {
  editor: Editor;
  assetPath: string;
  pos?: number;
}

export function insertExistingAsset({
  editor,
  assetPath,
  pos,
}: InsertExistingAssetOptions): void {
  const category = Sandbox.categorizeAsset(assetPath);
  if (category !== 'image') {
    return;
  }
  const fileDir = editor.storage.pubExtensions?.fileDir;
  if (fileDir === undefined) {
    return;
  }
  const relSrc = relative(fileDir, assetPath);

  let chain = editor.chain().focus();
  if (pos !== undefined) {
    chain = chain.setTextSelection(pos);
  }
  chain.setImage({ src: relSrc }).scrollIntoView().run();
}
