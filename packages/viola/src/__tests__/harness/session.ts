import { ref } from 'valtio';

import type { TokenStore } from '@v/auth-client';
import { $session } from '../../stores/accessors';
import { buildTestClients, type TestClients } from './clients';

// Production code wires `$session.auth` to an `IndexedDBTokenStore`, which
// throws under Node. Tests swap in a `MemoryTokenStore`-backed pair in
// `beforeEach`; pass the returned `tokenStore` back in to share login state
// across "two tabs on the same session" scenarios.
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
