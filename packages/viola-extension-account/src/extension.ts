import { defineExtension } from '@v/viola-extension-kit';
import { m } from './generated/paraglide/messages';
import { toLocale } from './locale';

export default defineExtension({
  id: 'account',
  name: 'Account',
  panes: [
    {
      path: '.',
      title: (locale) => m.account_pane_title({}, { locale: toLocale(locale) }),
      presentation: 'pane',
    },
  ],
  permalinks: [{ path: '.' }],
  permissions: ['session:read', 'session:write'],
});
