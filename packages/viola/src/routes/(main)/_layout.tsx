import { createFileRoute, Outlet } from '@tanstack/react-router';

import { Layout } from '../../components/layout';

export const Route = createFileRoute('/(main)/_layout')({
  component: AppLayoutView,
});

function AppLayoutView() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
