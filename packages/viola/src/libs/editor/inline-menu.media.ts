import { dirname, extname, join, relative } from 'pathe';
import { ref } from 'valtio';

import { ImageIcon } from '@v/ui/icon';
import { $content, $sandbox } from '../../stores/accessors';
import { SandboxFile } from '../../stores/proxies/sandbox';
import { generateId } from '../generate-id';
import { openFilePicker } from '../open-file-picker';
import { registerInlineMenuPlugin } from './inline-menu';

registerInlineMenuPlugin({
  id: 'media',
  triggers: ['!', '！'],
  items: [
    {
      id: 'image',
      label: 'Insert Image',
      icon: ImageIcon,
      onSelect: async ({ contentId, editor, from }) => {
        const fileContent = $content.valueOrThrow().files.get(contentId);
        if (!fileContent) return;

        const [file] = await openFilePicker({
          accept: 'image/*',
        });
        if (!file) return;
        const $$sandbox = $sandbox.valueOrThrow();
        const ext = extname(file.name).replace(/^\./, '') || 'png';
        const id = generateId();
        const dir = dirname(fileContent.filename);
        const savePath = join(dir, 'assets', `${id}.${ext}`);
        const relSrc = relative(dir, savePath);
        const bytes = new Uint8Array(await file.arrayBuffer());
        $$sandbox.files[savePath] = ref(
          new SandboxFile(file.type || `image/${ext}`, bytes),
        );
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to: from + 1 })
          .setImage({ src: relSrc })
          .run();
      },
    },
  ],
});
