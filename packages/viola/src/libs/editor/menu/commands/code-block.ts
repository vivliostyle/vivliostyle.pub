import {
  findSelectedCodeBlock,
  resolveVfmLanguage,
} from '@v/tiptap-extensions';
import { BracesIcon } from '@v/ui/icon';
import { CodeBlockPanel } from '../../../../components/content-editor/code-block-panel';
import { m } from '../../../../generated/paraglide/messages';
import { registerEditorMenuCommand } from '../registry';
import { isInCodeBlock } from './utils';

registerEditorMenuCommand({
  id: 'code-block.info',
  surfaces: ['selection'],
  label: m.editor_command_code_block_info,
  icon: BracesIcon,
  isVisible: isInCodeBlock,
  value: (editor) => {
    const block = findSelectedCodeBlock(editor.state);
    return (
      resolveVfmLanguage(block?.node.attrs.language) ??
      m.editor_command_code_block_info_plain_text()
    );
  },
  panel: CodeBlockPanel,
});
