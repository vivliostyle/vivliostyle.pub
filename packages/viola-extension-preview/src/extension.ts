import { defineExtension } from '@v/extension-kit';

export default defineExtension({
  id: 'preview',
  name: 'Preview',
  panes: [
    {
      path: '.',
      title: 'preview_pane_title',
      sizing: 'fill',
    },
  ],
  permissions: ['viewer:read'],
});
