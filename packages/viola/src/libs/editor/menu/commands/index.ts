import { m } from '../../../../generated/paraglide/messages';
import { registerEditorMenuGroupLabel } from '../registry';

import './block';
import './code-block';
import './format';
import './insert';
import './html-elements';
import './vfm';

registerEditorMenuGroupLabel('basic', m.trigger_menu_group_basic);
registerEditorMenuGroupLabel('list', m.trigger_menu_group_list);
registerEditorMenuGroupLabel('insert', m.trigger_menu_group_insert);
registerEditorMenuGroupLabel('theme', m.trigger_menu_group_theme);
registerEditorMenuGroupLabel('block-type', m.selection_toolbar_block_type_aria);
