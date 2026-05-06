import { extname, join, relative } from 'pathe';
import { ref } from 'valtio';

import type { ImageSaver } from '@v/tiptap-extensions';
import { $sandbox } from '../../stores/accessors';
import { SandboxFile } from '../../stores/proxies/sandbox';
import { generateId } from '../generate-id';

export function createSandboxImageSaver({
  fileDir,
}: {
  fileDir: string;
}): ImageSaver {
  return {
    async saveImage(file) {
      const ext = extname(file.name).replace(/^\./, '') || 'png';
      const id = generateId();
      const savePath = join(fileDir, 'assets', `${id}.${ext}`);
      const relSrc = relative(fileDir, savePath);
      const bytes = new Uint8Array(await file.arrayBuffer());
      $sandbox.valueOrThrow().files[savePath] = ref(
        new SandboxFile(file.type || `image/${ext}`, bytes),
      );
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
