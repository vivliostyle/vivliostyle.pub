import { defineExtension } from '@v/viola-extension-kit';
import { m } from './generated/paraglide/messages';
import { toLocale } from './locale';

export default defineExtension({
  id: 'preview',
  name: 'Preview',
  panes: [
    {
      path: '.',
      title: (locale) => m.preview_pane_title({}, { locale: toLocale(locale) }),
      sizing: 'fill',
    },
  ],
  permissions: ['viewer:read'],
});
