import { AuthError } from '@v/auth-client';
import { $session } from '../accessors';
import { discoverProjects } from './discover-projects';

// Resolves once `restoreSession()` has settled `$session.status` out of
// `'initial'`. Await it when racing the boot-time restoration.
export let sessionReady: Promise<void> = Promise.resolve();

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

function describeAuthFailure(error: unknown, fallback: string): SessionError {
  if (error instanceof AuthError) {
    if (error.status === 0) {
      return new SessionError(
        'Could not reach the server. Check your network connection.',
        0,
      );
    }
    if (error.status === 401) {
      return new SessionError('Incorrect username or password.', error.status);
    }
    if (error.status === 409) {
      return new SessionError('That username is already taken.', error.status);
    }
    return new SessionError(
      `${fallback} (status ${error.status}).`,
      error.status,
    );
  }
  return new SessionError(fallback);
}

export function restoreSession(): Promise<void> {
  if ($session.status === 'authenticating') {
    return sessionReady;
  }
  $session.status = 'initial';
  sessionReady = (async () => {
    if (!__CLOUD_ENABLED__) {
      $session.user = null;
      $session.status = 'anonymous';
      discoverProjects().catch(() => {});
      return;
    }
    if (await completePendingProviderSignIn()) {
      return;
    }
    try {
      const user = await $session.auth.getUser();
      if (user) {
        $session.user = user;
        $session.status = 'authenticated';
      } else {
        $session.user = null;
        $session.status = 'anonymous';
      }
    } catch {
      $session.user = null;
      $session.status = 'anonymous';
    }
    // Best-effort refresh of the merged project list; failures here are
    // benign (no remote reachable).
    discoverProjects().catch(() => {});
  })();
  return sessionReady;
}

export async function login(username: string, password: string): Promise<void> {
  $session.status = 'authenticating';
  try {
    await $session.auth.login(username, password);
    const user = await $session.auth.getUser();
    if (!user) {
      throw new SessionError('Logged in, but failed to load profile.');
    }
    $session.user = user;
    $session.status = 'authenticated';
  } catch (error) {
    $session.user = null;
    $session.status = 'anonymous';
    const wrapped = describeAuthFailure(error, 'Login failed');
    throw wrapped;
  }
  await discoverProjects().catch(() => {});
}

export async function register(
  username: string,
  password: string,
): Promise<void> {
  $session.status = 'authenticating';
  try {
    await $session.auth.register(username, password);
  } catch (error) {
    $session.status = 'anonymous';
    const wrapped = describeAuthFailure(error, 'Registration failed');
    throw wrapped;
  }
  await login(username, password);
}

export async function logout(): Promise<void> {
  try {
    await $session.auth.logout();
  } finally {
    $session.user = null;
    $session.status = 'anonymous';
  }
  await discoverProjects().catch(() => {});
}

export async function applyBearerSession(sessionToken: string): Promise<void> {
  $session.status = 'authenticating';
  try {
    await $session.auth.exchangeSession(sessionToken);
    const user = await $session.auth.getUser();
    if (!user) {
      throw new SessionError('Signed in, but failed to load profile.');
    }
    $session.user = user;
    $session.status = 'authenticated';
  } catch (error) {
    $session.user = null;
    $session.status = 'anonymous';
    throw describeAuthFailure(error, 'Sign-in failed');
  }
  await discoverProjects().catch(() => {});
}

export async function clearBearerSession(): Promise<void> {
  await logout();
}

const PROVIDER_NONCE_PARAM = 'vp_provider_signin';

function providerApiBase(): string {
  return new URL($session.baseUrl || '/', location.origin).href.replace(
    /\/+$/,
    '',
  );
}

export function startProviderSignIn(provider: string): void {
  const nonce = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '');
  const returnUrl = new URL(location.href);
  returnUrl.searchParams.set(PROVIDER_NONCE_PARAM, nonce);
  const start = new URL(`${providerApiBase()}/auth/provider/start`);
  start.searchParams.set('provider', provider);
  start.searchParams.set('return', returnUrl.href);
  location.assign(start.href);
}

async function claimProviderToken(
  base: string,
  nonce: string,
): Promise<string | null> {
  const url = `${base}/auth/provider/claim?nonce=${encodeURIComponent(nonce)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as { status?: string; token?: string };
        if (data.status === 'ok' && data.token) {
          return data.token;
        }
      }
    } catch {}
  }
  return null;
}

async function completePendingProviderSignIn(): Promise<boolean> {
  if (typeof location === 'undefined') {
    return false;
  }
  const url = new URL(location.href);
  const nonce = url.searchParams.get(PROVIDER_NONCE_PARAM);
  if (!nonce) {
    return false;
  }
  url.searchParams.delete(PROVIDER_NONCE_PARAM);
  history.replaceState(null, '', url.href);
  const token = await claimProviderToken(providerApiBase(), nonce);
  if (!token) {
    return false;
  }
  await applyBearerSession(token);
  return true;
}
