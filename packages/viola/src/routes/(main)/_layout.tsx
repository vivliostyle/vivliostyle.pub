import { createFileRoute, Outlet } from '@tanstack/react-router';
import { use } from 'react';

import { Layout } from '../../components/layout';
import { ensureExtensionsActivated } from '../../stores/actions/extension';

export const Route = createFileRoute('/(main)/_layout')({
  component: AppLayoutView,
});

function AppLayoutView() {
  use(ensureExtensionsActivated());

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
