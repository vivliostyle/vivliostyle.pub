import { ImageIcon } from '@v/ui/icon';
import { Sandbox } from '../../stores/proxies/sandbox';
import { openFilePicker } from '../open-file-picker';
import { registerInlineMenuPlugin } from './inline-menu';
import { insertImageFiles } from './insert-image';

registerInlineMenuPlugin({
  id: 'media',
  triggers: ['!', '！'],
  items: [
    {
      id: 'image',
      label: 'Insert Image',
      icon: ImageIcon,
      onSelect: async ({ contentId, editor, from }) => {
        const files = await openFilePicker({
          accept: Sandbox.getMediaAccept('image'),
        });
        if (files.length === 0) {
          return;
        }
        await insertImageFiles({
          editor,
          contentId,
          files,
          range: { from, to: from + 1 },
        });
      },
    },
  ],
});
