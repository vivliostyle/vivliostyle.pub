import { useId, useState } from 'react';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import { Loader2 } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { Label } from '@v/ui/label';
import { $session } from '../../stores/accessors';
import {
  login,
  logout,
  register,
  SessionError,
} from '../../stores/actions/session';
import { createPane, PaneContainer, ScrollOverflow } from './util';

type AccountPaneProps = object;

declare global {
  interface PanePropertyMap {
    account: AccountPaneProps;
  }
}

export const Pane = createPane<AccountPaneProps>({
  title: () => 'Account',
  content: (props) => (
    <ScrollOverflow>
      <PaneContainer>
        <Content {...props} />
      </PaneContainer>
    </ScrollOverflow>
  ),
});

type Mode = 'login' | 'register';

function SignInForm() {
  const sessionSnap = useSnapshot($session);
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const usernameId = useId();
  const passwordId = useId();

  const submitting = sessionSnap.status === 'authenticating';
  const disabled = submitting || !username || !password;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password);
      }
      setPassword('');
    } catch (err) {
      setError(
        err instanceof SessionError
          ? err.message
          : 'Something went wrong. Try again.',
      );
    }
  };

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {mode === 'login'
            ? 'Sign in to sync projects with the cloud server.'
            : 'Create a new account on the cloud server.'}
        </p>
        <p className="text-xs text-muted-foreground">
          Server: <code className="font-mono">{sessionSnap.baseUrl}</code>
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={usernameId}>Username</Label>
        <Input
          id={usernameId}
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={1}
          maxLength={64}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={passwordId}>Password</Label>
        <Input
          id={passwordId}
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === 'register' ? 8 : 1}
          maxLength={256}
        />
        {mode === 'register' && (
          <p className="text-xs text-muted-foreground">
            At least 8 characters.
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={disabled}>
        {submitting && <Loader2 className="animate-spin" />}
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </Button>

      <button
        type="button"
        className="text-xs text-muted-foreground hover:underline justify-self-start"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
      >
        {mode === 'login'
          ? "Don't have an account? Create one."
          : 'Already have an account? Sign in.'}
      </button>
    </form>
  );
}

function SignedInView() {
  const sessionSnap = useSnapshot($session);
  const [signingOut, setSigningOut] = useState(false);

  const onLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm text-muted-foreground">Signed in as</p>
        <p className="text-lg font-medium">{sessionSnap.user?.username}</p>
        <p className="text-xs text-muted-foreground">
          Server: <code className="font-mono">{sessionSnap.baseUrl}</code>
        </p>
      </div>
      <Button
        variant="outline"
        onClick={onLogout}
        disabled={signingOut}
        className="justify-self-start"
      >
        {signingOut && <Loader2 className="animate-spin" />}
        Sign out
      </Button>
    </div>
  );
}

function Content(_: AccountPaneProps) {
  const sessionSnap = useSnapshot($session);

  if (sessionSnap.status === 'initial') {
    return (
      <div className="grid place-items-center py-8">
        <Loader2 className="animate-spin size-8 text-muted-foreground" />
      </div>
    );
  }
  if (sessionSnap.status === 'authenticated' && sessionSnap.user) {
    return <SignedInView />;
  }
  return <SignInForm />;
}
