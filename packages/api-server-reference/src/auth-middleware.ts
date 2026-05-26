import { createMiddleware } from 'hono/factory';

import type { AuthEnv } from './deps';
import type { SqliteStore } from './storage/sqlite-store';

export function bearerAuth(store: SqliteStore) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const accessToken = store.findAccessToken(token);
    if (!accessToken || accessToken.expiresAt < Date.now()) {
      return c.json({ error: 'invalid_token' }, 401);
    }
    c.set('userId', accessToken.userId);
    await next();
  });
}
