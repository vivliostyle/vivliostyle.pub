import { ImageIcon, LinkIcon, MinusIcon } from '@v/ui/icon';
import { LinkPanel } from '../../../../components/content-editor/panels/link-panel';
import { m } from '../../../../generated/paraglide/messages';
import { getMediaAccept } from '../../../media';
import { openFilePicker } from '../../../open-file-picker';
import { insertImageFiles } from '../../insert-image';
import { registerEditorMenuCommand } from '../registry';
import { splitKeywords } from './utils';

registerEditorMenuCommand({
  id: 'insert.horizontal-rule',
  surfaces: ['trigger'],
  label: m.editor_command_horizontal_rule,
  keywords: () => [
    ...splitKeywords(m.editor_command_horizontal_rule_keywords()),
    'hr',
    '---',
  ],
  icon: MinusIcon,
  run: ({ editor }) => {
    editor.chain().focus().setHorizontalRule().run();
  },
});

registerEditorMenuCommand({
  id: 'insert.image',
  surfaces: ['trigger'],
  label: m.editor_command_insert_image,
  keywords: () => [
    ...splitKeywords(m.editor_command_insert_image_keywords()),
    'img',
  ],
  icon: ImageIcon,
  run: async ({ editor }) => {
    const files = await openFilePicker({
      accept: getMediaAccept('image'),
    });
    if (files.length === 0) {
      return;
    }
    await insertImageFiles({ editor, files });
  },
});

registerEditorMenuCommand({
  id: 'insert.link',
  surfaces: ['trigger'],
  label: m.editor_command_insert_link,
  keywords: () => [
    ...splitKeywords(m.editor_command_insert_link_keywords()),
    'link',
    'url',
  ],
  icon: LinkIcon,
  panel: LinkPanel,
});
