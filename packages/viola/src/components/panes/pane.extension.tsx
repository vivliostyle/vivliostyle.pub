import * as Comlink from 'comlink';
import { useEffect, useRef, useState } from 'react';
import { subscribe } from 'valtio';

import type {
  ExtensionAuthErrorCode,
  ExtensionHostApi,
  ExtensionPermission,
  ExtensionSessionSnapshot,
} from '@v/extension-kit';
import { Loader2 } from '@v/ui/icon';
import { attachExtensionAutoSize } from '../../extensions/iframe-autosize';
import {
  extensionFramePath,
  extensionSandboxOrigin,
} from '../../extensions/sandbox-origin';
import { getLocale } from '../../generated/paraglide/runtime';
import {
  currentColorScheme,
  subscribeColorScheme,
} from '../../libs/color-scheme';
import { $cli, $session } from '../../stores/accessors';
import {
  applyBearerSession,
  clearBearerSession,
  login,
  logout,
  register,
  SessionError,
  startProviderSignIn,
} from '../../stores/actions/session';
import {
  type ExtensionId,
  getExtensionPermissions,
  resolvePaneSizing,
  resolvePaneTitle,
} from '../../stores/proxies/extension';
import { createPane } from './util';

interface ExtensionPaneProperty {
  extensionId: ExtensionId;
  panePath: string;
}

declare global {
  interface PanePropertyMap {
    extension: ExtensionPaneProperty;
  }
}

function sessionSnapshot(): ExtensionSessionSnapshot {
  return {
    status: $session.status,
    user: $session.user
      ? { id: $session.user.id, username: $session.user.username }
      : null,
    baseUrl: $session.baseUrl,
  };
}

// Collapse transport/HTTP details into stable codes the sandbox UI localizes.
// Done here (the trust boundary) rather than in `session.ts` so the extra
// `status` field on `SessionError` doesn't need to survive Comlink — only the
// resulting code string crosses the boundary.
function authErrorCode(error: unknown): ExtensionAuthErrorCode {
  if (error instanceof SessionError) {
    if (error.status === 0) return 'network';
    if (error.status === 401) return 'invalid_credentials';
    if (error.status === 409) return 'username_taken';
  }
  return 'unknown';
}

async function runAuth(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    throw new Error(authErrorCode(error));
  }
}

/**
 * Ends a subscription along with the frame's binding. The returned function
 * ends it early, and does nothing once it has ended.
 */
type TrackSubscription = (unsubscribe: () => void) => () => void;

type HostApiMethod<K extends keyof ExtensionHostApi> = {
  permission: ExtensionPermission | null;
} & (
  | { impl: ExtensionHostApi[K] }
  | { bind: (track: TrackSubscription) => ExtensionHostApi[K] }
);

type HostApiRegistry = {
  [K in keyof ExtensionHostApi]: HostApiMethod<K>;
};

const hostApiRegistry: HostApiRegistry = {
  getLocale: {
    permission: null,
    impl: () => getLocale(),
  },
  getColorScheme: {
    permission: null,
    impl: () => currentColorScheme(),
  },
  subscribeColorScheme: {
    permission: null,
    bind: (track) => (listener) =>
      Comlink.proxy(track(subscribeColorScheme(listener))),
  },
  getSessionSnapshot: {
    permission: 'session:read',
    impl: () => sessionSnapshot(),
  },
  subscribeSession: {
    permission: 'session:read',
    bind: (track) => (listener) =>
      Comlink.proxy(
        track(subscribe($session, () => listener(sessionSnapshot()))),
      ),
  },
  login: {
    permission: 'session:write',
    impl: (username, password) => runAuth(() => login(username, password)),
  },
  register: {
    permission: 'session:write',
    impl: (username, password) => runAuth(() => register(username, password)),
  },
  logout: {
    permission: 'session:write',
    impl: () => runAuth(() => logout()),
  },
  applyBearerSession: {
    permission: 'session:write',
    impl: (token) => runAuth(() => applyBearerSession(token)),
  },
  clearBearerSession: {
    permission: 'session:write',
    impl: () => runAuth(() => clearBearerSession()),
  },
  startProviderSignIn: {
    permission: 'session:write',
    impl: async (provider) => {
      startProviderSignIn(provider);
    },
  },
  getViewerUrl: {
    permission: 'viewer:read',
    impl: async () => {
      const cli = await $cli.awaiter({ timeout: 10_000 });
      return await cli.createViewerUrlPromise();
    },
  },
  apiFetch: {
    permission: 'api:request',
    impl: async (path, init) => {
      const token = await $session.auth.getAccessToken();
      const res = await fetch(`${$session.baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          ...init?.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: init?.body,
      });
      const body = await res.arrayBuffer();
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { ok: res.ok, status: res.status, headers, body };
    },
  },
};

function denyPermission(
  method: keyof ExtensionHostApi,
  permission: ExtensionPermission,
): () => never {
  return () => {
    throw new Error(
      `Permission "${permission}" is required to call "${method}", but this extension was not granted it. Add "${permission}" to the permissions array in defineExtension().`,
    );
  };
}

function createExtensionHostApi(
  permissions: ReadonlySet<ExtensionPermission>,
  track: TrackSubscription,
): ExtensionHostApi {
  const api = {} as Record<keyof ExtensionHostApi, unknown>;
  for (const name of Object.keys(
    hostApiRegistry,
  ) as (keyof ExtensionHostApi)[]) {
    const method = hostApiRegistry[name];
    api[name] =
      method.permission === null || permissions.has(method.permission)
        ? 'impl' in method
          ? method.impl
          : method.bind(track)
        : denyPermission(name, method.permission);
  }
  return api as ExtensionHostApi;
}

/**
 * Exposes the host API on `port`. The returned function closes the port and
 * ends every subscription the extension made through it.
 */
function bindExtensionHostApi(
  port: MessagePort,
  permissions: ReadonlySet<ExtensionPermission>,
): () => void {
  const subscriptions = new Set<() => void>();
  const track: TrackSubscription = (unsubscribe) => {
    const tracked = () => {
      if (subscriptions.delete(tracked)) {
        unsubscribe();
      }
    };
    subscriptions.add(tracked);
    return tracked;
  };
  Comlink.expose(createExtensionHostApi(permissions, track), port);
  return () => {
    port.close();
    for (const unsubscribe of subscriptions) {
      unsubscribe();
    }
  };
}

export const Pane = createPane<ExtensionPaneProperty>({
  title: ({ extensionId, panePath }) => (
    <>{resolvePaneTitle(extensionId, panePath, getLocale())}</>
  ),
  content: (props) => <Content {...props} />,
});

function Content({ extensionId, panePath }: ExtensionPaneProperty) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const origin = extensionSandboxOrigin(extensionId);
  const sizing = resolvePaneSizing(extensionId, panePath);

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let unbind: (() => void) | undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.command !== 'extension-bind') return;
      const [port] = event.ports;
      if (!port) return;
      // A frame binds once per document, so the previous document is gone.
      unbind?.();
      unbind = bindExtensionHostApi(port, getExtensionPermissions(extensionId));
    };
    window.addEventListener('message', onMessage);
    const detachAutoSize =
      sizing === 'content'
        ? attachExtensionAutoSize(iframe, origin)
        : undefined;
    return () => {
      window.removeEventListener('message', onMessage);
      unbind?.();
      detachAutoSize?.();
    };
  }, [origin, extensionId, sizing]);

  const iframe = (
    <iframe
      ref={iframeRef}
      title={resolvePaneTitle(extensionId, panePath, getLocale())}
      src={`${origin}${extensionFramePath(extensionId, panePath)}`}
      onLoad={() => setLoaded(true)}
      // With `content` sizing the height tracks the content (see
      // iframe-autosize); width fills the pane and the height is capped at the
      // wrapper so taller content scrolls inside the iframe itself.
      className={sizing === 'fill' ? 'size-full' : 'w-full'}
      sandbox="allow-same-origin allow-scripts allow-modals allow-forms"
      allow="cross-origin-isolated"
    />
  );

  // The iframe stays mounted to fire its `load` event, so the spinner overlays
  // it rather than replacing it.
  const spinner = !loaded && (
    <div className="absolute inset-0 grid place-items-center bg-background">
      <Loader2 className="animate-spin size-12 text-gray-300" />
    </div>
  );

  if (sizing === 'fill') {
    return (
      <div className="relative size-full">
        {iframe}
        {spinner}
      </div>
    );
  }
  return (
    <div className="relative size-full overflow-auto overscroll-contain scrollbar-stable">
      {iframe}
      {spinner}
    </div>
  );
}
