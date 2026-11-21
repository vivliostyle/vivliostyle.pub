import { extname, join, relative } from 'pathe';

import type { ImageSaver } from '@v/tiptap-extensions';
import { generateId } from '../generate-id';
import { getMimeTypeByExtension } from '../media';
import { SandboxFile } from '../sandbox/file';

export function createSandboxImageSaver({
  fileDir,
  writeFile,
}: {
  fileDir: string;
  writeFile: (path: string, file: SandboxFile) => void;
}): ImageSaver {
  return {
    async saveImage(file) {
      const ext = extname(file.name).replace(/^\./, '') || 'png';
      const id = generateId();
      const savePath = join(fileDir, 'assets', `${id}.${ext}`);
      const relSrc = relative(fileDir, savePath);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType =
        file.type || getMimeTypeByExtension(ext) || 'application/octet-stream';
      writeFile(savePath, new SandboxFile(mimeType, bytes));
      return { src: relSrc };
    },
  };
}

export function createObjectUrlImageSaver(): ImageSaver {
  return {
    async saveImage(file) {
      return { src: URL.createObjectURL(file) };
    },
  };
}
