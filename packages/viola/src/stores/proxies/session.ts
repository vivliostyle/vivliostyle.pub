import { proxy, ref } from 'valtio';

import { ApiClient } from '@v/api-client';
import { AuthClient, type AuthUser } from '@v/auth-client';
import { IndexedDBTokenStore } from '../../libs/token-store';

export type SessionStatus =
  | 'initial'
  | 'anonymous'
  | 'authenticated'
  | 'authenticating';

const DEFAULT_BASE_URL = '/api';
const CLIENT_ID = 'vivliostyle-pub-web';

function buildRedirectUri(): string {
  // The reference server validates credentials directly on /oauth/authorize
  // and never actually redirects, but the value must be a valid absolute URL
  // and must round-trip identically through /oauth/token.
  if (typeof location === 'undefined') {
    return 'http://localhost/';
  }
  return `${location.origin}/`;
}

function createAuthClient(baseUrl: string): AuthClient {
  return new AuthClient({
    baseUrl,
    clientId: CLIENT_ID,
    redirectUri: buildRedirectUri(),
    tokenStore: new IndexedDBTokenStore(),
  });
}

function createApiClient(baseUrl: string, authClient: AuthClient): ApiClient {
  return new ApiClient({
    baseUrl,
    getAccessToken: authClient.accessTokenProvider,
  });
}

const initialBaseUrl = DEFAULT_BASE_URL;
const initialAuth = createAuthClient(initialBaseUrl);

export const session = proxy({
  baseUrl: initialBaseUrl,
  status: 'initial' as SessionStatus,
  user: null as AuthUser | null,
  auth: ref(initialAuth),
  api: ref(createApiClient(initialBaseUrl, initialAuth)),
});

export function rebuildClients(baseUrl: string) {
  const auth = createAuthClient(baseUrl);
  session.baseUrl = baseUrl;
  session.auth = ref(auth);
  session.api = ref(createApiClient(baseUrl, auth));
}
