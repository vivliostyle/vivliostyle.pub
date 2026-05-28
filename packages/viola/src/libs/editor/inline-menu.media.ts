import { ImageIcon } from '@v/ui/icon';
import { m } from '../../generated/paraglide/messages';
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
      label: m.inline_menu_insert_image(),
      icon: ImageIcon,
      onSelect: async ({ editor, from }) => {
        const files = await openFilePicker({
          accept: Sandbox.getMediaAccept('image'),
        });
        if (files.length === 0) {
          return;
        }
        await insertImageFiles({
          editor,
          files,
          range: { from, to: from + 1 },
        });
      },
    },
  ],
});
