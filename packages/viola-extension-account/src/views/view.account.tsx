import * as Comlink from 'comlink';
import { useEffect, useId, useState } from 'react';

import { Button } from '@v/ui/button';
import { Loader2 } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { Label } from '@v/ui/label';
import { PaneContainer } from '@v/ui/pane';
import type {
  ExtensionMountContext,
  ExtensionSessionSnapshot,
  RemoteExtensionHostApi,
} from '@v/viola-extension-kit';
import { m } from '../generated/paraglide/messages';
import type { Locale } from '../generated/paraglide/runtime';
import { toLocale } from '../locale';

import '@v/viola-extension-kit/styles.css';

type Mode = 'login' | 'register';

function errorMessage(error: unknown, locale: Locale): string {
  const code = error instanceof Error ? error.message : '';
  switch (code) {
    case 'invalid_credentials':
      return m.account_error_invalid_credentials({}, { locale });
    case 'username_taken':
      return m.account_error_username_taken({}, { locale });
    case 'network':
      return m.account_error_network({}, { locale });
    default:
      return m.account_generic_error({}, { locale });
  }
}

function useSessionSnapshot(
  host: RemoteExtensionHostApi,
): ExtensionSessionSnapshot | null {
  const [snapshot, setSnapshot] = useState<ExtensionSessionSnapshot | null>(
    null,
  );
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => unknown) | undefined;
    void (async () => {
      const initial = await host.getSessionSnapshot();
      if (!disposed) {
        setSnapshot(initial);
      }
      const unsub = await host.subscribeSession(
        Comlink.proxy((next: ExtensionSessionSnapshot) => setSnapshot(next)),
      );
      if (disposed) {
        void unsub();
      } else {
        unsubscribe = unsub;
      }
    })();
    return () => {
      disposed = true;
      void unsubscribe?.();
    };
  }, [host]);
  return snapshot;
}

interface ViewProps {
  host: RemoteExtensionHostApi;
  locale: Locale;
  snapshot: ExtensionSessionSnapshot;
}

function SignInForm({ host, locale, snapshot }: ViewProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const usernameId = useId();
  const passwordId = useId();

  const submitting = snapshot.status === 'authenticating';
  const disabled = submitting || !username || !password;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      if (mode === 'login') {
        await host.login(username, password);
      } else {
        await host.register(username, password);
      }
      setPassword('');
    } catch (err) {
      setError(errorMessage(err, locale));
    }
  };

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {mode === 'login'
            ? m.account_login_description({}, { locale })
            : m.account_register_description({}, { locale })}
        </p>
        <p className="text-xs text-muted-foreground">
          {m.account_server_label({}, { locale })}{' '}
          <code className="font-mono">{snapshot.baseUrl}</code>
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={usernameId}>
          {m.account_username_label({}, { locale })}
        </Label>
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
        <Label htmlFor={passwordId}>
          {m.account_password_label({}, { locale })}
        </Label>
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
            {m.account_password_min_chars_note({}, { locale })}
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
        {mode === 'login'
          ? m.account_sign_in_button({}, { locale })
          : m.account_register_button({}, { locale })}
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
          ? m.account_switch_to_register({}, { locale })
          : m.account_switch_to_login({}, { locale })}
      </button>
    </form>
  );
}

function SignedInView({ host, locale, snapshot }: ViewProps) {
  const [signingOut, setSigningOut] = useState(false);

  const onLogout = async () => {
    setSigningOut(true);
    try {
      await host.logout();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm text-muted-foreground">
          {m.account_signed_in_as({}, { locale })}
        </p>
        <p className="text-lg font-medium">{snapshot.user?.username}</p>
        <p className="text-xs text-muted-foreground">
          {m.account_server_label({}, { locale })}{' '}
          <code className="font-mono">{snapshot.baseUrl}</code>
        </p>
      </div>
      <Button
        variant="outline"
        onClick={onLogout}
        disabled={signingOut}
        className="justify-self-start"
      >
        {signingOut && <Loader2 className="animate-spin" />}
        {m.account_sign_out_button({}, { locale })}
      </Button>
    </div>
  );
}

export default function AccountPane({ host, locale }: ExtensionMountContext) {
  const snapshot = useSessionSnapshot(host);
  const loc = toLocale(locale);

  let body: React.ReactNode;
  if (!snapshot || snapshot.status === 'initial') {
    body = null;
  } else if (snapshot.status === 'authenticated' && snapshot.user) {
    body = <SignedInView host={host} locale={loc} snapshot={snapshot} />;
  } else {
    body = <SignInForm host={host} locale={loc} snapshot={snapshot} />;
  }

  return <PaneContainer>{body}</PaneContainer>;
}
