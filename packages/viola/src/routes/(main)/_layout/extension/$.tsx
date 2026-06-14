import { createFileRoute, redirect } from '@tanstack/react-router';

import { openPermalink } from '../../../../stores/actions/extension';

export const Route = createFileRoute('/(main)/_layout/extension/$')({
  component: () => null,
  beforeLoad: async ({ preload, params }) => {
    if (preload) {
      return;
    }
    if (!(await openPermalink(params._splat ?? ''))) {
      throw redirect({ to: '/' });
    }
  },
});
