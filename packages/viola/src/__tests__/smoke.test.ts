import { beforeEach, describe, expect, it } from 'vitest';

import { buildTestClients } from './harness/clients';
import { buildTestServer } from './harness/server';
import { bindApp } from './setup';

describe('test harness smoke', () => {
  let server: ReturnType<typeof buildTestServer>;

  beforeEach(() => {
    server = buildTestServer();
    bindApp(server.root);
  });

  it('routes SDK fetch through the in-process API server', async () => {
    const { auth } = buildTestClients();
    await expect(
      auth.register('alice', 'password123'),
    ).resolves.toBeUndefined();
    await expect(auth.login('alice', 'password123')).resolves.toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });
});
