import { ApiClient } from '@v/api-client';
import { AuthClient, MemoryTokenStore, type TokenStore } from '@v/auth-client';

const TEST_BASE_URL = 'http://test.invalid/api';
const TEST_CLIENT_ID = 'vivliostyle-pub-web';
const TEST_REDIRECT_URI = 'http://test.invalid/';

export interface BuildClientsOptions {
  baseUrl?: string;
  tokenStore?: TokenStore;
}

export interface TestClients {
  auth: AuthClient;
  api: ApiClient;
  tokenStore: TokenStore;
}

export function buildTestClients(
  options: BuildClientsOptions = {},
): TestClients {
  const baseUrl = options.baseUrl ?? TEST_BASE_URL;
  const tokenStore = options.tokenStore ?? new MemoryTokenStore();
  const auth = new AuthClient({
    baseUrl,
    clientId: TEST_CLIENT_ID,
    redirectUri: TEST_REDIRECT_URI,
    tokenStore,
  });
  const api = new ApiClient({
    baseUrl,
    getAccessToken: auth.accessTokenProvider,
  });
  return { auth, api, tokenStore };
}
