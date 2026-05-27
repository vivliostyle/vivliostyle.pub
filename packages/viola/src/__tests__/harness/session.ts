import { ref } from 'valtio';

import type { TokenStore } from '@v/auth-client';
import { $session } from '../../stores/accessors';
import { buildTestClients, type TestClients } from './clients';

// Swap viola's module-singleton `$session` over to test-built clients backed
// by a `MemoryTokenStore`. Production code defaults to `IndexedDBTokenStore`,
// which throws under Node — every test must call this in `beforeEach`.
//
// The returned `tokenStore` can be passed back in via `options.tokenStore` to
// share login state across "two clients on the same session" scenarios.
export function setupTestSession(
  options: { tokenStore?: TokenStore } = {},
): TestClients {
  const clients = buildTestClients({ tokenStore: options.tokenStore });
  $session.auth = ref(clients.auth);
  $session.api = ref(clients.api);
  $session.user = null;
  $session.status = 'initial';
  return clients;
}
