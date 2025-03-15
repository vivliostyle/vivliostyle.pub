import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import React, { Suspense } from 'react';

export const Route = createRootRoute({
  component: () => <Outlet />,
});
