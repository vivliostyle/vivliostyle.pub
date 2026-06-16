import { defineExtension } from '@v/extension-kit';

export default defineExtension({
  id: 'account',
  name: 'Account',
  panes: [
    {
      path: '.',
      title: 'account_pane_title',
      presentation: 'pane',
    },
  ],
  permalinks: [{ path: '.' }],
  permissions: ['session:read', 'session:write'],
});
