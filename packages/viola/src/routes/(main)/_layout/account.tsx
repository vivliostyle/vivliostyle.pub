import { createFileRoute, redirect } from '@tanstack/react-router';

import { openPermalink } from '../../../stores/actions/extension';

// Serves the account extension's permalink at the bare `/account` path
// alongside the canonical `/extension/account` route.
export const Route = createFileRoute('/(main)/_layout/account')({
  component: () => null,
  beforeLoad: async ({ preload }) => {
    if (preload) {
      return;
    }
    if (!(await openPermalink('account'))) {
      throw redirect({ to: '/' });
    }
  },
});
