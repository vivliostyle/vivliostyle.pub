import type { Editor } from '@tiptap/core';

export interface InsertImageFilesOptions {
  editor: Editor;
  files: File[];
  range?: { from: number; to: number };
  pos?: number;
}

export async function insertImageFiles({
  editor,
  files,
  range,
  pos,
}: InsertImageFilesOptions): Promise<void> {
  const saver = editor.storage.pubExtensions?.imageSaver;
  if (!saver) {
    return;
  }

  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) {
    return;
  }

  const sources: string[] = [];
  for (const file of images) {
    const { src } = await saver.saveImage(file);
    sources.push(src);
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
