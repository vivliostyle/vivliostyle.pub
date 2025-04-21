import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import React, { Suspense } from 'react';
import { Layout } from '../components/layout';

export const Route = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});
