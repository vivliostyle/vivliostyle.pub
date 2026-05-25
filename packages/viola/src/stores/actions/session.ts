import { AuthError } from '@v/auth-client';
import { $session } from '../accessors';
import { discoverProjects } from './discover-projects';

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

/**
 * Reads any persisted refresh token from IndexedDB and, if found, hydrates
 * `$session` with the current user. Safe to call repeatedly; no-ops when
 * already authenticating.
 */
export async function restoreSession(): Promise<void> {
  if ($session.status === 'authenticating') {
    return;
  }
  $session.status = 'initializing';
  $session.lastError = null;
  try {
    const user = await $session.authClient.getUser();
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
}

export async function login(username: string, password: string): Promise<void> {
  $session.status = 'authenticating';
  $session.lastError = null;
  try {
    await $session.authClient.login(username, password);
    const user = await $session.authClient.getUser();
    if (!user) {
      throw new SessionError('Logged in, but failed to load profile.');
    }
    $session.user = user;
    $session.status = 'authenticated';
  } catch (error) {
    $session.user = null;
    $session.status = 'anonymous';
    const wrapped = describeAuthFailure(error, 'Login failed');
    $session.lastError = wrapped.message;
    throw wrapped;
  }
  await discoverProjects().catch(() => {});
}

export async function register(
  username: string,
  password: string,
): Promise<void> {
  $session.status = 'authenticating';
  $session.lastError = null;
  try {
    await $session.authClient.register(username, password);
  } catch (error) {
    $session.status = 'anonymous';
    const wrapped = describeAuthFailure(error, 'Registration failed');
    $session.lastError = wrapped.message;
    throw wrapped;
  }
  await login(username, password);
}

export async function logout(): Promise<void> {
  try {
    await $session.authClient.logout();
  } finally {
    $session.user = null;
    $session.status = 'anonymous';
    $session.lastError = null;
  }
  await discoverProjects().catch(() => {});
}
