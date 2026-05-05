import type { Editor } from '@tiptap/core';
import { dirname, extname, join, relative } from 'pathe';
import { ref } from 'valtio';

import { $content, $sandbox } from '../../stores/accessors';
import type { ContentId } from '../../stores/proxies/content';
import { SandboxFile } from '../../stores/proxies/sandbox';
import { generateId } from '../generate-id';

export interface InsertImageFilesOptions {
  editor: Editor;
  contentId: ContentId;
  files: File[];
  range?: { from: number; to: number };
  pos?: number;
}

export async function insertImageFiles({
  editor,
  contentId,
  files,
  range,
  pos,
}: InsertImageFilesOptions): Promise<void> {
  const fileContent = $content.valueOrThrow().files.get(contentId);
  if (!fileContent) {
    return;
  }

  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) {
    return;
  }

  const $$sandbox = $sandbox.valueOrThrow();
  const dir = dirname(fileContent.filename);

  const sources: string[] = [];
  for (const file of images) {
    const ext = extname(file.name).replace(/^\./, '') || 'png';
    const id = generateId();
    const savePath = join(dir, 'assets', `${id}.${ext}`);
    const relSrc = relative(dir, savePath);
    const bytes = new Uint8Array(await file.arrayBuffer());
    $$sandbox.files[savePath] = ref(
      new SandboxFile(file.type || `image/${ext}`, bytes),
    );
    sources.push(relSrc);
  }

  let chain = editor.chain().focus();
  if (range) {
    chain = chain.setTextSelection(range);
  } else if (pos !== undefined) {
    chain = chain.setTextSelection(pos);
  }
  for (const src of sources) {
    chain = chain.setImage({ src });
  }
  chain.scrollIntoView().run();
}
