import { Hono } from 'hono';

import { createApp } from '@v/api-server-reference/app';

// Wrap the reference server under `/api` to match the production layout,
// where viola's `__API_BASE_URL__` already includes that prefix.
export function buildTestServer() {
  const inner = createApp();
  const root = new Hono();
  root.route('/api', inner.app);
  return { root, inner: inner.app, deps: inner.deps };
}

export type TestServer = ReturnType<typeof buildTestServer>;
