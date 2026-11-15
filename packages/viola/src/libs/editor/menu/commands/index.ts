import { m } from '../../../../generated/paraglide/messages';
import { registerEditorMenuGroupLabel } from '../registry';

import './block';
import './code-block';
import './format';
import './insert';

registerEditorMenuGroupLabel('basic', m.trigger_menu_group_basic);
registerEditorMenuGroupLabel('list', m.trigger_menu_group_list);
registerEditorMenuGroupLabel('insert', m.trigger_menu_group_insert);
registerEditorMenuGroupLabel('block-type', m.selection_menu_block_type_aria);
