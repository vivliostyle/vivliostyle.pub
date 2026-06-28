import { proxy, ref } from 'valtio';

import { ApiClient } from '@v/api-client';
import { AuthClient, type AuthUser } from '@v/auth-client';
import { IndexedDBTokenStore } from '../../libs/token-store';

export type SessionStatus =
  | 'initial'
  | 'anonymous'
  | 'authenticated'
  | 'authenticating';

// Extensions read `baseUrl` (via the session snapshot) and fetch the API from
// their own cross-origin sandbox iframe, where a relative base (e.g. `/api`)
// would resolve against the sandbox origin instead of the host. Anchor a
// relative base to the host origin so `baseUrl` is always absolute; an empty
// base is left untouched (see `DEFAULT_BASE_URL`).
function toAbsoluteBaseUrl(baseUrl: string): string {
  if (!baseUrl || typeof location === 'undefined') {
    return baseUrl;
  }
  return new URL(baseUrl, location.origin).href.replace(/\/+$/, '');
}

// `__API_BASE_URL__` is `''` when the build was made without an API server
// configured. The session is still constructed so the proxy stays shaped the
// same, but we deliberately do NOT fall back to `/api` here: callers must
// gate on `__CLOUD_ENABLED__` (and `restoreSession()` short-circuits to
// `'anonymous'`) so a stray auth call when cloud is disabled fails loudly
// against an empty base URL instead of silently hitting a non-existent
// local endpoint.
const DEFAULT_BASE_URL = toAbsoluteBaseUrl(__API_BASE_URL__);
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
  const absoluteBaseUrl = toAbsoluteBaseUrl(baseUrl);
  const auth = createAuthClient(absoluteBaseUrl);
  session.baseUrl = absoluteBaseUrl;
  session.auth = ref(auth);
  session.api = ref(createApiClient(absoluteBaseUrl, auth));
}
